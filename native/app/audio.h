// audio.h — low-latency CoreAudio playback
#ifndef KLICK_AUDIO_H
#define KLICK_AUDIO_H

#include <stdbool.h>
#include <stdint.h>
#include <AudioToolbox/AudioToolbox.h>

#define KLICK_ROLE_KEYS 0
#define KLICK_ROLE_SPACE 1
#define KLICK_ROLE_ENTER 2
#define KLICK_ROLE_DELETE 3
#define KLICK_ROLE_MODIFIER 4
#define KLICK_ROLE_RELEASE 5
#define KLICK_ROLE_CLICK 6
#define KLICK_ROLE_COUNT 7

bool audio_init(void);
void audio_shutdown(void);

// Load every pack under packsDir; the first directory is the default.
int audio_load_packs(const char *packsDir);
int audio_pack_count(void);
const char *audio_pack_name(int index);
bool audio_select_pack(int index);

// Called from the capture thread: never blocks, never allocates.
void audio_trigger(int role, float pan, float gain, float rate, uint64_t host_time);

double audio_latency_ms(void);      // last tap -> render start
void audio_reload_for_device(void); // after output device change / wake
bool audio_take_reconfigure_flag(void);
bool audio_is_running(void);
bool audio_load_cues(const char *dir);
void audio_trigger_cue(int which, float gain);
void audio_trigger_cue_rate(int which, float gain, float rate);
void audio_test_mix(float *interleaved, uint32_t frames);
OSStatus audio_init_status(void);
OSStatus audio_start_status(void);
unsigned long audio_render_count(void);
unsigned long audio_voice_count(void);
double audio_device_rate(void);
int audio_pack_volume_ok(void);

#endif
