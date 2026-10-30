// stats.c — XP curve, hat unlocks and milestone detection.
#include "stats.h"

#include <math.h>
#include <stddef.h>

// Same curve as the 0.3.x JS store: level n needs 120 * n * (n + 1) / 2 XP.
int klick_level_for(uint32_t xp) {
    return (int)floor((-1.0 + sqrt(1.0 + (8.0 * (double)xp) / 120.0)) / 2.0) + 1;
}

const char *klick_hat_for(int level) {
    if (level >= 15) return "crown";
    if (level >= 10) return "chef";
    if (level >= 8) return "beanie";
    if (level >= 6) return "headphones";
    if (level >= 4) return "sunglasses";
    if (level >= 2) return "party";
    return NULL;
}

// Returns the milestone that was crossed (e.g. 100), or 0 if none.
uint32_t klick_milestone_crossed(uint32_t before, uint32_t after, uint32_t every) {
    if (every == 0 || after <= before) return 0;
    uint32_t from = before / every;
    uint32_t to = after / every;
    return to > from ? to * every : 0;
}
