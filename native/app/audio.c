// audio.c — CoreAudio (AudioUnit DefaultOutput) with a lock-free trigger ring.
//
// Design goals:
//   * key -> sound without touching JS: the CGEventTap thread pushes a trigger
//     into a ring buffer and the render callback consumes it (no locks, no malloc).
//   * a small device buffer (64 frames by default) so output latency stays ~1.3 ms.
//   * sample-rate matching: samples are converted with ExtAudioFile to the current
//     hardware rate and re-converted when the output device changes.
//   * the default output device is watched, so headphones/AirPods are followed
//     instead of going silent.

#include "audio.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <math.h>
#include <mach/mach_time.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>

#define MAX_PACKS 32
#define MAX_TAKES 6
#define MAX_VOICES 48
#define RING_SIZE 256

typedef struct {
    float *data;
    uint32_t frames;
} Take;

typedef struct {
    Take takes[MAX_TAKES];
    int count;
} RoleSamples;

typedef struct {
    char name[64];
    RoleSamples roles[KLICK_ROLE_COUNT];
} Pack;

typedef struct {
    uint8_t role;
    float pan;
    float gain;
    float rate;
    uint64_t ts;
} Trigger;

typedef struct {
    const float *data;
    uint32_t frames;
    double pos;
    double inc;
    float gl;
    float gr;
    bool active;
} Voice;

static Pack g_packs[MAX_PACKS];
static int g_pack_count = 0;
static _Atomic int g_pack_active = 0;

static AudioUnit g_unit = NULL;
static double g_device_rate = 48000.0;

static Voice g_voices[MAX_VOICES];

static Trigger g_ring[RING_SIZE];
static _Atomic uint32_t g_ring_head = 0;
static _Atomic uint32_t g_ring_tail = 0;

static _Atomic int g_reconfigure_needed = 0;
static Take g_cues[2];                      // 0 = done, 1 = error
static double g_latency_ms = 0;
static OSStatus g_init_status = -1;
static OSStatus g_start_status = -1;
static volatile bool g_running = false;
static volatile unsigned long g_render_count = 0;
static volatile unsigned long g_voice_count = 0;
static mach_timebase_info_data_t g_timebase;

static pthread_mutex_t g_reload_lock = PTHREAD_MUTEX_INITIALIZER;

// ------------------------------------------------------------------ helpers

static void free_pack(Pack *pack) {
    for (int r = 0; r < KLICK_ROLE_COUNT; r++) {
        for (int t = 0; t < pack->roles[r].count; t++) {
            free(pack->roles[r].takes[t].data);
            pack->roles[r].takes[t].data = NULL;
        }
        pack->roles[r].count = 0;
    }
}

// Convert one WAV file to mono float32 at the device rate using ExtAudioFile,
// which resamples for us (44.1/48/96 kHz all land at the hardware rate).
static Take load_take(const char *path) {
    Take out = { NULL, 0 };
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault, (const UInt8 *)path, (CFIndex)strlen(path), false);
    if (!url) return out;

    ExtAudioFileRef file = NULL;
    if (ExtAudioFileOpenURL(url, &file) != noErr) { CFRelease(url); return out; }

    AudioStreamBasicDescription fmt = {0};
    fmt.mSampleRate = g_device_rate;
    fmt.mFormatID = kAudioFormatLinearPCM;
    fmt.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    fmt.mChannelsPerFrame = 1;
    fmt.mBitsPerChannel = 32;
    fmt.mBytesPerPacket = 4;
    fmt.mFramesPerPacket = 1;
    fmt.mBytesPerFrame = 4;
    ExtAudioFileSetProperty(file, kExtAudioFileProperty_ClientDataFormat,
                            sizeof(fmt), &fmt);

    SInt64 total = 0;
    UInt32 size = sizeof(total);
    ExtAudioFileGetProperty(file, kExtAudioFileProperty_FileLengthFrames, &size, &total);
    if (total <= 0) total = g_device_rate;   // unknown length: read to EOF
    total += 64;

    float *buffer = calloc((size_t)total, sizeof(float));
    if (!buffer) { ExtAudioFileDispose(file); CFRelease(url); return out; }

    UInt32 written = 0;
    while (written < (UInt32)total) {
        UInt32 want = (UInt32)total - written;
        AudioBufferList list;
        list.mNumberBuffers = 1;
        list.mBuffers[0].mNumberChannels = 1;
        list.mBuffers[0].mDataByteSize = want * sizeof(float);
        list.mBuffers[0].mData = buffer + written;
        UInt32 got = want;
        if (ExtAudioFileRead(file, &got, &list) != noErr || got == 0) break;
        written += got;
    }
    ExtAudioFileDispose(file);
    CFRelease(url);

    if (written == 0) { free(buffer); return out; }
    out.data = buffer;
    out.frames = written;
    return out;
}

static void load_pack_dir(Pack *pack, const char *dir) {
    static const char *role_names[KLICK_ROLE_COUNT] = {
        "keys", "space", "enter", "delete", "modifier", "release", "click"
    };
    for (int r = 0; r < KLICK_ROLE_COUNT; r++) {
        char path[1024];
        snprintf(path, sizeof path, "%s/%s-1.wav", dir, role_names[r]);
        if (access(path, R_OK) == 0) {
            // numbered takes: keys-1.wav, keys-2.wav, ...
            for (int take = 1; take <= MAX_TAKES; take++) {
                snprintf(path, sizeof path, "%s/%s-%d.wav", dir, role_names[r], take);
                if (access(path, R_OK) != 0) break;
                Take t = load_take(path);
                if (t.data) pack->roles[r].takes[pack->roles[r].count++] = t;
            }
        } else {
            // single unnumbered file: space.wav
            snprintf(path, sizeof path, "%s/%s.wav", dir, role_names[r]);
            if (access(path, R_OK) != 0) continue;
            Take t = load_take(path);
            if (t.data) pack->roles[r].takes[pack->roles[r].count++] = t;
        }
    }
}

static double default_device_rate(void) {
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, &device) != noErr)
        return 48000.0;

    addr.mSelector = kAudioDevicePropertyNominalSampleRate;
    Float64 rate = 48000.0;
    size = sizeof(rate);
    if (AudioObjectGetPropertyData(device, &addr, 0, NULL, &size, &rate) != noErr || rate < 8000)
        rate = 48000.0;
    return rate;
}

// Ask the device for a small buffer; fall back to 128 then the device default.
static UInt32 set_device_buffer(UInt32 frames) {
    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioDeviceID device = kAudioObjectUnknown;
    UInt32 size = sizeof(device);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, NULL, &size, &device) != noErr)
        return 0;

    addr.mSelector = kAudioDevicePropertyBufferFrameSize;
    addr.mScope = kAudioObjectPropertyScopeOutput;
    UInt32 value = frames;
    if (AudioObjectSetPropertyData(device, &addr, 0, NULL, sizeof(value), &value) != noErr)
        return 0;
    return value;
}

// ------------------------------------------------------------ render callback

static void start_voice(const Trigger *t, uint64_t now) {
    Take *sample = NULL;
    if (t->role >= 200) {
        int which = t->role - 200;
        if (which > 1 || !g_cues[which].data) return;
        sample = &g_cues[which];
    } else {
        Pack *pack = &g_packs[atomic_load(&g_pack_active)];
        RoleSamples *role = &pack->roles[t->role];
        if (role->count == 0) return;
        sample = &role->takes[arc4random_uniform((uint32_t)role->count)];
    }

    for (int i = 0; i < MAX_VOICES; i++) {
        if (g_voices[i].active) continue;
        Voice *v = &g_voices[i];
        v->data = sample->data;
        v->frames = sample->frames;
        // 0.985..1.015 like the JS engine: the same key never sounds identical
        v->inc = t->rate;
        v->pos = 0;
        float pan = t->pan < -1 ? -1 : (t->pan > 1 ? 1 : t->pan);
        float angle = (pan + 1.0f) * 0.25f * (float)M_PI;
        v->gl = cosf(angle) * t->gain * 1.4142f;
        v->gr = sinf(angle) * t->gain * 1.4142f;
        v->active = true;
        g_voice_count++;

        if (now > t->ts && g_timebase.denom) {
            uint64_t delta = now - t->ts;
            double ns = (double)delta * (double)g_timebase.numer / (double)g_timebase.denom;
            g_latency_ms = ns / 1e6;
        }
        return;
    }
}

// The mixing loop, shared by the realtime callback and the offline test hook.
static void mix_slice(float *left, float *right, uint32_t frames) {
    uint32_t head = atomic_load_explicit(&g_ring_head, memory_order_acquire);
    uint32_t tail = atomic_load(&g_ring_tail);
    uint64_t now = mach_absolute_time();

    while (tail != head) {
        start_voice(&g_ring[tail % RING_SIZE], now);
        tail = (tail + 1) % RING_SIZE;
        atomic_store_explicit(&g_ring_tail, tail, memory_order_release);
    }

    for (int i = 0; i < MAX_VOICES; i++) {
        Voice *v = &g_voices[i];
        if (!v->active) continue;
        for (UInt32 f = 0; f < frames; f++) {
            uint32_t idx = (uint32_t)v->pos;
            if (idx + 1 >= v->frames) { v->active = false; break; }
            float frac = (float)(v->pos - idx);
            float s = v->data[idx] * (1.0f - frac) + v->data[idx + 1] * frac;
            left[f] += s * v->gl;
            if (right) right[f] += s * v->gr;
            v->pos += v->inc;
        }
    }

    for (UInt32 f = 0; f < frames; f++) {
        if (left[f] > 1.0f) left[f] = 1.0f;
        if (left[f] < -1.0f) left[f] = -1.0f;
        if (right) {
            if (right[f] > 1.0f) right[f] = 1.0f;
            if (right[f] < -1.0f) right[f] = -1.0f;
        }
    }
}

static OSStatus render(void *ref, AudioUnitRenderActionFlags *flags,
                       const AudioTimeStamp *ts, UInt32 bus, UInt32 frames,
                       AudioBufferList *io) {
    (void)ref; (void)flags; (void)ts; (void)bus;
    g_render_count++;

    float *left = (float *)io->mBuffers[0].mData;
    float *right = io->mNumberBuffers > 1 ? (float *)io->mBuffers[1].mData : NULL;

    memset(left, 0, frames * sizeof(float));
    if (right) memset(right, 0, frames * sizeof(float));
    mix_slice(left, right, frames);
    return noErr;
}

// Offline hook for the smoke tests: renders into interleaved stereo.
void audio_test_mix(float *interleaved, uint32_t frames) {
    float *left = calloc(frames, sizeof(float));
    float *right = calloc(frames, sizeof(float));
    if (!left || !right) { free(left); free(right); return; }
    mix_slice(left, right, frames);
    for (uint32_t f = 0; f < frames; f++) {
        interleaved[f * 2 + 0] = left[f];
        interleaved[f * 2 + 1] = right[f];
    }
    free(left);
    free(right);
}

// ---------------------------------------------------------------- device watch

static OSStatus device_changed(AudioObjectID object, UInt32 count,
                               const AudioObjectPropertyAddress *addrs, void *client) {
    (void)object; (void)count; (void)addrs; (void)client;
    atomic_store(&g_reconfigure_needed, 1);
    return noErr;
}

// --------------------------------------------------------------- unit control

static bool build_unit(void) {
    AudioComponentDescription desc = {
        .componentType = kAudioUnitType_Output,
        .componentSubType = kAudioUnitSubType_DefaultOutput,
        .componentManufacturer = kAudioUnitManufacturer_Apple,
        .componentFlags = 0,
        .componentFlagsMask = 0
    };
    AudioComponent component = AudioComponentFindNext(NULL, &desc);
    if (!component) return false;
    if (AudioComponentInstanceNew(component, &g_unit) != noErr) return false;

    g_device_rate = default_device_rate();

    AudioStreamBasicDescription fmt = {0};
    fmt.mSampleRate = g_device_rate;
    fmt.mFormatID = kAudioFormatLinearPCM;
    fmt.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsNonInterleaved | kAudioFormatFlagIsPacked;
    fmt.mChannelsPerFrame = 2;
    fmt.mBitsPerChannel = 32;
    fmt.mBytesPerPacket = 4;
    fmt.mFramesPerPacket = 1;
    fmt.mBytesPerFrame = 4;
    AudioUnitSetProperty(g_unit, kAudioUnitProperty_StreamFormat,
                         kAudioUnitScope_Input, 0, &fmt, sizeof(fmt));

    UInt32 slice = 512;
    AudioUnitSetProperty(g_unit, kAudioUnitProperty_MaximumFramesPerSlice,
                         kAudioUnitScope_Global, 0, &slice, sizeof(slice));

    AURenderCallbackStruct cb = { .inputProc = render, .inputProcRefCon = NULL };
    AudioUnitSetProperty(g_unit, kAudioUnitProperty_SetRenderCallback,
                         kAudioUnitScope_Input, 0, &cb, sizeof(cb));

    g_init_status = AudioUnitInitialize(g_unit);
    if (g_init_status != noErr) { AudioComponentInstanceDispose(g_unit); g_unit = NULL; return false; }
    g_start_status = AudioOutputUnitStart(g_unit);
    if (g_start_status != noErr) { AudioComponentInstanceDispose(g_unit); g_unit = NULL; return false; }
    g_running = true;
    return true;
}

static void teardown_unit(void) {
    g_running = false;
    if (!g_unit) return;
    AudioOutputUnitStop(g_unit);
    AudioUnitUninitialize(g_unit);
    AudioComponentInstanceDispose(g_unit);
    g_unit = NULL;
}

// The pack root is remembered so a device change can rebuild everything.
static char g_packs_root[1024] = {0};

// ------------------------------------------------------------------- public

bool audio_init(void) {
    mach_timebase_info(&g_timebase);

    AudioObjectPropertyAddress addr = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioObjectAddPropertyListener(kAudioObjectSystemObject, &addr, device_changed, NULL);

    set_device_buffer(64);
    return build_unit();
}

void audio_shutdown(void) {
    teardown_unit();
    for (int p = 0; p < g_pack_count; p++) free_pack(&g_packs[p]);
    g_pack_count = 0;
}

void audio_trigger(int role, float pan, float gain, float rate, uint64_t host_time) {
    uint32_t head = atomic_load_explicit(&g_ring_head, memory_order_relaxed);
    uint32_t next = (head + 1) % RING_SIZE;
    if (next == atomic_load(&g_ring_tail)) return;   // full: drop, never block
    Trigger *t = &g_ring[head];
    t->role = (uint8_t)role;
    t->pan = pan;
    t->gain = gain;
    t->rate = rate;
    t->ts = host_time;
    atomic_store_explicit(&g_ring_head, next, memory_order_release);
}

int audio_load_packs(const char *packsDir) {
    strncpy(g_packs_root, packsDir, sizeof(g_packs_root) - 1);
    DIR *dir = opendir(packsDir);
    if (!dir) return 0;
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL && g_pack_count < MAX_PACKS) {
        if (entry->d_name[0] == '.') continue;
        char path[1024];
        snprintf(path, sizeof path, "%s/%s", packsDir, entry->d_name);
        DIR *inner = opendir(path);
        if (!inner) continue;
        closedir(inner);

        Pack *pack = &g_packs[g_pack_count];
        memset(pack, 0, sizeof(*pack));
        strncpy(pack->name, entry->d_name, sizeof(pack->name) - 1);
        load_pack_dir(pack, path);
        if (pack->roles[KLICK_ROLE_KEYS].count > 0) g_pack_count++;
        else free_pack(pack);
    }
    closedir(dir);
    return g_pack_count;
}

int audio_pack_count(void) { return g_pack_count; }

const char *audio_pack_name(int index) {
    if (index < 0 || index >= g_pack_count) return "";
    return g_packs[index].name;
}

bool audio_select_pack(int index) {
    if (index < 0 || index >= g_pack_count) return false;
    atomic_store(&g_pack_active, index);
    return true;
}

double audio_latency_ms(void) { return g_latency_ms; }
double audio_device_rate(void) { return g_device_rate; }
int audio_pack_volume_ok(void) { return g_pack_count; }

// Called on the main thread when the output device changed or the Mac woke up.
// The voices and samples are re-converted to the new hardware rate, so nothing
// plays at the wrong pitch and nothing goes silent.
void audio_reload_for_device(void) {
    int active = atomic_load(&g_pack_active);

    teardown_unit();
    for (int p = 0; p < g_pack_count; p++) free_pack(&g_packs[p]);
    g_pack_count = 0;

    if (!build_unit()) return;
    if (g_packs_root[0]) audio_load_packs(g_packs_root);
    if (active >= g_pack_count) active = 0;
    atomic_store(&g_pack_active, active);
}

bool audio_take_reconfigure_flag(void) {
    return atomic_exchange(&g_reconfigure_needed, 0) != 0;
}

bool audio_is_running(void) { return g_running; }

bool audio_load_cues(const char *dir) {
    char path[1024];
    snprintf(path, sizeof path, "%s/done.wav", dir);
    g_cues[0] = load_take(path);
    snprintf(path, sizeof path, "%s/error.wav", dir);
    g_cues[1] = load_take(path);
    return g_cues[0].data != NULL;
}

void audio_trigger_cue(int which, float gain) {
    audio_trigger(200 + which, 0.0f, gain, 1.0f, mach_absolute_time());
}

void audio_trigger_cue_rate(int which, float gain, float rate) {
    audio_trigger(200 + which, 0.0f, gain, rate, mach_absolute_time());
}
OSStatus audio_init_status(void) { return g_init_status; }
OSStatus audio_start_status(void) { return g_start_status; }
unsigned long audio_render_count(void) { return g_render_count; }
unsigned long audio_voice_count(void) { return g_voice_count; }
