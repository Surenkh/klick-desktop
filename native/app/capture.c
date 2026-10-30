// capture.c — a listen-only CGEventTap on its own thread.
//
// Listen-only means the OS forbids us from modifying or blocking events: Klick
// can never delay or swallow a keystroke. Only Input Monitoring is required.

#include "capture.h"

#include <ApplicationServices/ApplicationServices.h>
#include <pthread.h>

static CFMachPortRef g_tap = NULL;
static CFRunLoopRef g_loop = NULL;
static klick_key_fn g_fn = NULL;
static CFRunLoopSourceRef g_source = NULL;
static volatile bool g_running = false;

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *user) {
    (void)proxy; (void)user;

    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        // the system disabled us (slow callback or sleep); just switch back on
        if (g_tap) CGEventTapEnable(g_tap, true);
        return event;
    }
    if (!g_fn) return event;

    uint64_t ts = (uint64_t)CGEventGetTimestamp(event);   // mach absolute time

    if (type == kCGEventKeyDown || type == kCGEventKeyUp) {
        int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        g_fn((uint16_t)code, type == kCGEventKeyDown, ts);
    } else if (type == kCGEventFlagsChanged) {
        int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
        static CGEventFlags prev = 0;
        CGEventFlags now = CGEventGetFlags(event);
        CGEventFlags mask = kCGEventFlagMaskShift | kCGEventFlagMaskControl |
                            kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand |
                            kCGEventFlagMaskSecondaryFn;
        if ((now & mask) != (prev & mask) && (now & mask) != 0) g_fn((uint16_t)code, true, ts);
        prev = now;
    }
    return event;
}

static void *tap_thread(void *arg) {
    (void)arg;
    g_loop = CFRunLoopGetCurrent();

    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) |
                       CGEventMaskBit(kCGEventFlagsChanged);
    g_tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap,
                             kCGEventTapOptionListenOnly, mask, on_event, NULL);
    if (!g_tap) { g_running = false; return NULL; }

    g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
    CFRunLoopAddSource(g_loop, g_source, kCFRunLoopCommonModes);
    CGEventTapEnable(g_tap, true);
    g_running = true;

    CFRunLoopRun();
    return NULL;
}

bool klick_capture_has_permission(void) {
    return CGPreflightListenEventAccess();
}

bool klick_capture_start(klick_key_fn fn) {
    if (g_running) return true;
    if (!CGPreflightListenEventAccess()) {
        CGRequestListenEventAccess();
        return false;
    }
    g_fn = fn;
    pthread_t thread;
    if (pthread_create(&thread, NULL, tap_thread, NULL) != 0) return false;
    pthread_detach(thread);

    // give the thread a moment to create the port
    for (int i = 0; i < 50 && !g_running; i++) usleep(2000);
    return g_running;
}

void klick_capture_recover(void) {
    if (g_tap) {
        CGEventTapEnable(g_tap, true);
    } else {
        klick_capture_start(g_fn);
    }
}

void klick_capture_stop(void) {
    if (g_loop) CFRunLoopStop(g_loop);
    if (g_source) { CFRelease(g_source); g_source = NULL; }
    if (g_tap) { CFRelease(g_tap); g_tap = NULL; }
    g_running = false;
}
