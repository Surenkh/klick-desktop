// klick-capture — an N-API addon that listens for keys *inside* Klick.app.
//
// Being in-process matters: macOS grants Input Monitoring to the app bundle, so
// a separate helper binary sees a different (missing) identity and reports
// "no permission" even when the user granted it. In-process, the grant applies.
//
// It uses a LISTEN-ONLY CGEventTap: it may not modify or block events, so Klick
// can never delay or swallow a keystroke.

#include <node_api.h>
#include <ApplicationServices/ApplicationServices.h>
#include <pthread.h>
#include <stdlib.h>

static napi_threadsafe_function g_tsfn = NULL;
static CFMachPortRef g_tap = NULL;
static volatile int g_status = 0;   // 0 idle, 1 running, 2 permission, 3 failed
static pthread_t g_thread;
static volatile int g_started = 0;
static CGEventFlags g_flags = 0;

typedef struct { int code; int down; } key_event;

static void call_js(napi_env env, napi_value js_cb, void *context, void *data) {
    (void)context;
    if (!env || !js_cb) { free(data); return; }
    key_event *ev = (key_event *)data;
    napi_value argv[2];
    napi_create_int32(env, ev->code, &argv[0]);
    napi_create_int32(env, ev->down, &argv[1]);
    napi_value global;
    napi_get_global(env, &global);
    napi_call_function(env, global, js_cb, 2, argv, NULL);
    free(ev);
}

static void post_key(int code, int down) {
    if (!g_tsfn) return;
    key_event *ev = (key_event *)malloc(sizeof(key_event));
    if (!ev) return;
    ev->code = code;
    ev->down = down;
    if (napi_call_threadsafe_function(g_tsfn, ev, napi_tsfn_nonblocking) != napi_ok) free(ev);
}

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *user) {
    (void)proxy; (void)user;
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (g_tap) CGEventTapEnable(g_tap, true);
        return event;
    }
    if (type == kCGEventLeftMouseDown) { post_key(-1, 1); return event; }
    int64_t code = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    if (type == kCGEventKeyDown) post_key((int)code, 1);
    else if (type == kCGEventKeyUp) post_key((int)code, 0);
    else if (type == kCGEventFlagsChanged) {
        CGEventFlags now = CGEventGetFlags(event);
        CGEventFlags mask = kCGEventFlagMaskShift | kCGEventFlagMaskControl |
                            kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand |
                            kCGEventFlagMaskSecondaryFn;
        if ((now & mask) != (g_flags & mask) && (now & mask) != 0) post_key((int)code, 1);
        g_flags = now;
    }
    return event;
}

static void *tap_thread(void *arg) {
    (void)arg;
    CFRunLoopRef loop = CFRunLoopGetCurrent();
    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) |
                       CGEventMaskBit(kCGEventFlagsChanged) | CGEventMaskBit(kCGEventLeftMouseDown);
    g_tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap,
                             kCGEventTapOptionListenOnly, mask, on_event, NULL);
    if (!g_tap) { g_status = 2; return NULL; }
    CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
    CFRunLoopAddSource(loop, source, kCFRunLoopCommonModes);
    CGEventTapEnable(g_tap, true);
    g_status = 1;
    CFRunLoopRun();
    return NULL;
}

static napi_value Start(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc < 1) return NULL;

    if (g_started) return NULL;

    // permission first: a tap created without it is a silent no-op
    if (!CGPreflightListenEventAccess()) {
        g_status = 2;
        CGRequestListenEventAccess();
        return NULL;
    }

    napi_value name;
    napi_create_string_utf8(env, "klick-capture", NAPI_AUTO_LENGTH, &name);
    napi_create_threadsafe_function(env, argv[0], NULL, name, 0, 1, NULL, NULL, NULL,
                                    call_js, &g_tsfn);
    napi_unref_threadsafe_function(env, g_tsfn);

    g_started = 1;
    pthread_create(&g_thread, NULL, tap_thread, NULL);
    pthread_detach(g_thread);
    return NULL;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
    (void)env; (void)info;
    if (g_tap) { CGEventTapEnable(g_tap, false); CFRelease(g_tap); g_tap = NULL; }
    if (g_tsfn) { napi_release_threadsafe_function(g_tsfn, napi_tsfn_release); g_tsfn = NULL; }
    g_status = 0;
    g_started = 0;
    return NULL;
}

static napi_value Status(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    napi_create_int32(env, g_status, &out);
    return out;
}

static napi_value Preflight(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    napi_get_boolean(env, CGPreflightListenEventAccess(), &out);
    return out;
}

static napi_value Request(napi_env env, napi_callback_info info) {
    (void)info;
    napi_value out;
    napi_get_boolean(env, CGRequestListenEventAccess(), &out);
    return out;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        { "start", NULL, Start, NULL, NULL, NULL, napi_default, NULL },
        { "stop", NULL, Stop, NULL, NULL, NULL, napi_default, NULL },
        { "status", NULL, Status, NULL, NULL, NULL, napi_default, NULL },
        { "preflight", NULL, Preflight, NULL, NULL, NULL, napi_default, NULL },
        { "request", NULL, Request, NULL, NULL, NULL, napi_default, NULL },
    };
    napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
