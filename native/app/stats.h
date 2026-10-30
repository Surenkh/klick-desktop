#ifndef KLICK_STATS_H
#define KLICK_STATS_H

#include <stdbool.h>
#include <stdint.h>

int klick_level_for(uint32_t xp);
const char *klick_hat_for(int level);
uint32_t klick_milestone_crossed(uint32_t before, uint32_t after, uint32_t every);

#endif
