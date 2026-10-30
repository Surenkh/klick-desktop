#ifndef KLICK_KEYMAP_H
#define KLICK_KEYMAP_H

#include <stdint.h>

typedef struct { int role; float pan; } KeyMap;

KeyMap klick_map_keycode(uint16_t code);

#endif
