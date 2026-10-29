// klick-keys — reads keyboard HID reports and prints them as lines on stdout.
//
// Deliberately NOT an event tap: IOHIDManager only *observes* device reports, so
// Klick never intercepts or delays input, and macOS asks for a single permission
// (Input Monitoring) instead of Accessibility.
//
// Protocol (one line each, unbuffered):
//   access granted|denied|unknown
//   ready
//   d <usage>     key down (HID keyboard usage page 0x07)
//   u <usage>     key up
//   device +|-    a keyboard appeared or went away

#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/hid/IOHIDKeys.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void emit(const char *line) {
    fputs(line, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

static void on_value(void *ctx, IOReturn result, void *sender, IOHIDValueRef value) {
    (void)ctx; (void)result; (void)sender;
    IOHIDElementRef element = IOHIDValueGetElement(value);
    if (!element) return;
    uint32_t page = IOHIDElementGetUsagePage(element);
    // 0x09 = Button page: mouse / trackpad clicks
    if (page == 0x09) {
        uint32_t button = IOHIDElementGetUsage(element);
        if (button >= 1 && button <= 3 && IOHIDValueGetIntegerValue(value) != 0) {
            char b[16];
            snprintf(b, sizeof b, "b %u", button);
            emit(b);
        }
        return;
    }
    // 0x07 = Generic Desktop / Keyboard-Keypad
    if (page != 0x07) return;
    uint32_t usage = IOHIDElementGetUsage(element);
    if (usage < 4) return; // error / rollover codes
    long down = IOHIDValueGetIntegerValue(value) != 0;
    char buf[32];
    snprintf(buf, sizeof buf, "%c %u", down ? 'd' : 'u', usage);
    emit(buf);
}

static void on_matched(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
    (void)ctx; (void)result; (void)sender; (void)device;
    emit("device +");
}

static void on_removed(void *ctx, IOReturn result, void *sender, IOHIDDeviceRef device) {
    (void)ctx; (void)result; (void)sender; (void)device;
    emit("device -");
}

static void on_signal(int sig) { (void)sig; exit(0); }

int main(void) {
    signal(SIGTERM, on_signal);
    signal(SIGINT, on_signal);
    setvbuf(stdout, NULL, _IONBF, 0);

    IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!manager) { emit("error manager"); return 2; }

    int keyboard = 0x06, keypad = 0x07, mouse = 0x02, page = 0x01;
    CFNumberRef pageRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &page);
    CFNumberRef kbRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &keyboard);
    CFNumberRef padRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &keypad);
    CFNumberRef mouseRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &mouse);

    CFMutableDictionaryRef k1 = CFDictionaryCreateMutable(kCFAllocatorDefault, 2,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(k1, CFSTR(kIOHIDDeviceUsagePageKey), pageRef);
    CFDictionarySetValue(k1, CFSTR(kIOHIDDeviceUsageKey), kbRef);
    CFMutableDictionaryRef k2 = CFDictionaryCreateMutable(kCFAllocatorDefault, 2,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(k2, CFSTR(kIOHIDDeviceUsagePageKey), pageRef);
    CFDictionarySetValue(k2, CFSTR(kIOHIDDeviceUsageKey), padRef);

    CFMutableDictionaryRef k3 = CFDictionaryCreateMutable(kCFAllocatorDefault, 2,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(k3, CFSTR(kIOHIDDeviceUsagePageKey), pageRef);
    CFDictionarySetValue(k3, CFSTR(kIOHIDDeviceUsageKey), mouseRef);

    CFMutableArrayRef matches = CFArrayCreateMutable(kCFAllocatorDefault, 3, &kCFTypeArrayCallBacks);
    CFArrayAppendValue(matches, k1);
    CFArrayAppendValue(matches, k2);
    CFArrayAppendValue(matches, k3);
    IOHIDManagerSetDeviceMatchingMultiple(manager, matches);

    IOHIDManagerRegisterInputValueCallback(manager, on_value, NULL);
    IOHIDManagerRegisterDeviceMatchingCallback(manager, on_matched, NULL);
    IOHIDManagerRegisterDeviceRemovalCallback(manager, on_removed, NULL);

    // public API, no private headers: tells the app where it stands instead of
    // guessing from silence. Returns true only when Input Monitoring is granted.
    emit(CGPreflightListenEventAccess() ? "access granted" : "access missing");

    IOReturn opened = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
    while (opened != kIOReturnSuccess) {
        // denied: wait for the user to flip the switch, then pick it up in place
        emit("waiting");
        for (int i = 0; i < 30; i++) {
            sleep(1);
            if (CGPreflightListenEventAccess()) break;
        }
        if (!CGPreflightListenEventAccess()) continue;
        emit("access granted");
        opened = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
        if (opened != kIOReturnSuccess) {
            char buf[48];
            snprintf(buf, sizeof buf, "error open %d", opened);
            emit(buf);
        }
    }
    IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), kCFRunLoopDefaultMode);
    emit("ready");

    CFRunLoopRun();
    return 0;
}
