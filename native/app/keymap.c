// keymap.c — CGKeyCode -> role + stereo position.
#include "keymap.h"
#include "audio.h"

KeyMap klick_map_keycode(uint16_t code) {
    KeyMap m = { KLICK_ROLE_KEYS, 0.0f };

    if (code == 49) { m.role = KLICK_ROLE_SPACE; return m; }
    if (code == 36 || code == 76) { m.role = KLICK_ROLE_ENTER; return m; }
    if (code == 51 || code == 117) { m.role = KLICK_ROLE_DELETE; return m; }
    if (code >= 54 && code <= 63) { m.role = KLICK_ROLE_MODIFIER; return m; }

    // QWERTY columns, same numbers as the JS table
    static const int row1[] = {12, 13, 14, 15, 17, 16, 32, 34, 31, 35};  // q w e r t y u i o p
    static const int row2[] = {0, 1, 2, 3, 5, 4, 38, 40, 37};            // a s d f g h j k l
    static const int row3[] = {6, 7, 8, 9, 11, 45, 46};                  // z x c v b n m
    static const int digits[] = {18, 19, 20, 21, 23, 22, 26, 28, 25, 29}; // 1..0

    float column = -1;
    for (int i = 0; i < 10; i++) if (row1[i] == code) column = 0.25f + i;
    if (column < 0) for (int i = 0; i < 9; i++) if (row2[i] == code) column = 0.4f + i;
    if (column < 0) for (int i = 0; i < 7; i++) if (row3[i] == code) column = 0.7f + i;
    if (column < 0) for (int i = 0; i < 10; i++) if (digits[i] == code) column = 0.5f + i;

    switch (code) {
        case 50: column = 0; break;
        case 27: column = 10; break;
        case 24: column = 11; break;
        case 33: column = 11.3f; break;
        case 30: column = 12.3f; break;
        case 42: column = 13; break;
        case 41: column = 10; break;
        case 39: column = 11.3f; break;
        case 43: column = 8.3f; break;
        case 47: column = 9.3f; break;
        case 44: column = 10.3f; break;
        default: break;
    }

    if (column >= 0) {
        float pan = (column / 9.0f - 0.5f) * 1.3f;
        if (pan < -0.65f) pan = -0.65f;
        if (pan > 0.65f) pan = 0.65f;
        m.pan = pan;
    }
    return m;
}

