// Smoke/unit tests for the native core: key mapping, pack loading, mixing, cues.
// No audio device required — the mixer runs offline through audio_test_mix().

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mach/mach_time.h>

#include "audio.h"
#include "keymap.h"
#include "stats.h"

static int failures = 0;

#define CHECK(cond, fmt, ...) do { \
    if (!(cond)) { printf("  FAIL  " fmt "\n", ##__VA_ARGS__); failures++; } \
    else { printf("  ok    " fmt "\n", ##__VA_ARGS__); } \
} while (0)

static int buffer_is_silent(const float *buf, int frames) {
    for (int i = 0; i < frames * 2; i++) if (fabsf(buf[i]) > 1e-6f) return 0;
    return 1;
}

int main(void) {
    printf("klick native tests\n");

    // ---- key mapping
    printf("keymap\n");
    CHECK(klick_map_keycode(49).role == KLICK_ROLE_SPACE, "space (49) is the space role");
    CHECK(klick_map_keycode(49).pan == 0.0f, "space is centred");
    CHECK(klick_map_keycode(36).role == KLICK_ROLE_ENTER, "return (36) is enter");
    CHECK(klick_map_keycode(76).role == KLICK_ROLE_ENTER, "keypad enter (76) is enter");
    CHECK(klick_map_keycode(51).role == KLICK_ROLE_DELETE, "delete (51)");
    CHECK(klick_map_keycode(117).role == KLICK_ROLE_DELETE, "forward delete (117)");
    CHECK(klick_map_keycode(55).role == KLICK_ROLE_MODIFIER, "command (55) is a modifier");

    KeyMap a = klick_map_keycode(0);    // a — left hand
    KeyMap p = klick_map_keycode(35);   // p — right hand
    CHECK(a.role == KLICK_ROLE_KEYS, "letters map to the keys role");
    CHECK(a.pan < 0.0f, "left-hand key pans left (%.2f)", a.pan);
    CHECK(p.pan > 0.0f, "right-hand key pans right (%.2f)", p.pan);
    CHECK(fabsf(a.pan) <= 0.66f && fabsf(p.pan) <= 0.66f, "pan stays inside the safe range");

    // ---- packs: real WAVs, resampled to the engine rate
    printf("stats\n");
    CHECK(klick_level_for(0) == 1, "0 xp is level 1");
    CHECK(klick_level_for(119) == 1, "119 xp is still level 1");
    CHECK(klick_level_for(120) == 2, "120 xp reaches level 2");
    CHECK(klick_level_for(360) == 3, "360 xp reaches level 3");
    CHECK(klick_level_for(720) == 4, "720 xp reaches level 4");
    CHECK(klick_level_for(1080) == 4, "1080 xp is still level 4");
    CHECK(klick_level_for(1200) == 5, "1200 xp reaches level 5");
    CHECK(klick_level_for(100000) > 20, "large xp keeps rising");

    CHECK(klick_hat_for(1) == NULL, "no hat at level 1");
    CHECK(strcmp(klick_hat_for(2), "beanie") == 0, "mint beanie at level 2");
    CHECK(strcmp(klick_hat_for(4), "baseball") == 0, "baseball cap at level 4");
    CHECK(strcmp(klick_hat_for(6), "explorer") == 0, "explorer hat at level 6");
    CHECK(strcmp(klick_hat_for(8), "wizard") == 0, "wizard hat at level 8");
    CHECK(strcmp(klick_hat_for(10), "graduation") == 0, "graduation cap at level 10");
    CHECK(strcmp(klick_hat_for(15), "crown") == 0, "crown at level 15");

    CHECK(klick_milestone_crossed(99, 100, 100) == 100, "99 -> 100 crosses the 100 milestone");
    CHECK(klick_milestone_crossed(100, 101, 100) == 0, "no repeat celebration at 101");
    CHECK(klick_milestone_crossed(0, 250, 100) == 200, "0 -> 250 reports the latest milestone (200)");
    CHECK(klick_milestone_crossed(499, 500, 100) == 500, "499 -> 500 crosses 500");
    CHECK(klick_milestone_crossed(10, 20, 0) == 0, "milestones can be off");
    CHECK(klick_milestone_crossed(20, 10, 100) == 0, "counters going backwards never celebrate");

    printf("packs\n");
    int packs = audio_load_packs("assets/packs");
    CHECK(packs >= 4, "packs load from assets/packs (got %d)", packs);
    for (int i = 0; i < packs; i++) {
        CHECK(strlen(audio_pack_name(i)) > 0, "pack %d has a name (%s)", i, audio_pack_name(i));
    }
    CHECK(audio_select_pack(0), "selecting pack 0 works");
    CHECK(strlen(audio_pack_name(0)) > 0, "pack 0 has a name (%s)", audio_pack_name(0));
    CHECK(strlen(audio_pack_name(99)) == 0, "out-of-range pack name is empty");
    CHECK(!audio_select_pack(-1), "negative pack index is rejected");
    CHECK(!audio_select_pack(99), "out-of-range pack index is rejected");

    // ---- mixing: a trigger must produce audio, the same mix must be reproducible
    printf("mixing\n");
    float buf[512 * 2];
    memset(buf, 0, sizeof(buf));
    audio_trigger(KLICK_ROLE_KEYS, 0.0f, 1.0f, 1.0f, mach_absolute_time());
    audio_test_mix(buf, 512);
    CHECK(!buffer_is_silent(buf, 512), "a key trigger produces non-silent output");

    float peak = 0;
    for (int i = 0; i < 512 * 2; i++) peak = fmaxf(peak, fabsf(buf[i]));
    CHECK(peak <= 1.0f, "output stays within [-1,1] (peak %.3f)", peak);

    // drain well past the longest sample (2 s at 48 kHz), then expect silence
    for (int block = 0; block < 200; block++) {
        memset(buf, 0, sizeof(buf));
        audio_test_mix(buf, 512);
    }
    memset(buf, 0, sizeof(buf));
    audio_test_mix(buf, 512);
    CHECK(buffer_is_silent(buf, 512), "silence once every voice has finished");

    // ---- cues
    printf("cues\n");
    CHECK(audio_load_cues("assets/cues"), "recorded cues load");
    memset(buf, 0, sizeof(buf));
    audio_trigger_cue(0, 1.0f);
    audio_test_mix(buf, 512);
    CHECK(!buffer_is_silent(buf, 512), "the done cue produces audio");

    printf(failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", failures);
    return failures ? 1 : 0;
}
