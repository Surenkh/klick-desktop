// capture.h — listen-only keyboard capture
#ifndef KLICK_CAPTURE_H
#define KLICK_CAPTURE_H

#include <stdbool.h>
#include <stdint.h>

typedef void (*klick_key_fn)(uint16_t keycode, bool down, uint64_t host_time);

bool klick_capture_start(klick_key_fn fn);
void klick_capture_stop(void);
void klick_capture_recover(void);      // after wake / tap disabled
bool klick_capture_has_permission(void);

#endif
