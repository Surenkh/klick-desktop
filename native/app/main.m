// main.m — Klick native shell (Objective-C).
//
// P1+P2: menu bar item, lazy WKWebView Settings, JS bridge, CGEventTap capture,
// CoreAudio playback with device following, sleep/wake recovery, launch at login.

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <ServiceManagement/ServiceManagement.h>
#include <mach/mach_time.h>
#include <math.h>
#include <stdatomic.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <sys/file.h>
#include <fcntl.h>

#include "audio.h"
#include "capture.h"

static const char *kBundleID = "app.klick.Klick";

// ---------------------------------------------------------------- key mapping

#include "keymap.h"
#include "stats.h"

// ------------------------------------------------------------------- app

@interface AppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler, NSWindowDelegate>
@property (nonatomic, strong) NSStatusItem *statusItem;
@property (nonatomic, strong) NSWindow *settingsWindow;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSMutableDictionary *settings;
@property (nonatomic, strong) NSMutableArray<NSString *> *packNames;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *packMeta;
@property (nonatomic, strong) NSString *packsDir;
@property (nonatomic, strong) NSString *logPath;
@property (nonatomic, assign) int activePack;
@property (nonatomic, assign) BOOL captureOK;
@property (nonatomic, assign) BOOL recordingTap;
@property (nonatomic, strong) NSPanel *buddyPanel;
@property (nonatomic, strong) WKWebView *buddyWeb;
@property (nonatomic, strong) NSPanel *counterPanel;
@property (nonatomic, strong) WKWebView *counterWeb;
@property (nonatomic, assign) int agentSocket;

- (void)buddyPulse;
- (void)flushStats;
- (void)buddyMood:(NSString *)mood;
- (NSDictionary *)statsPayload;
- (void)pushStats:(NSDictionary *)payload;
@end

static AppDelegate *gApp = nil;

@interface AppDelegate (Agents)
- (void)handleAgentLine:(NSString *)line;
@end

static void *agent_listener_thread(void *context) {
    NSString *path = (__bridge_transfer NSString *)context;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return NULL;
    unlink(path.UTF8String);

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path.UTF8String, sizeof(addr.sun_path) - 1);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) { close(fd); return NULL; }
    if (listen(fd, 8) != 0) { close(fd); return NULL; }

    for (;;) {
        int client = accept(fd, NULL, NULL);
        if (client < 0) continue;
        char buffer[1024] = {0};
        ssize_t n = read(client, buffer, sizeof(buffer) - 1);
        close(client);
        if (n <= 0) continue;
        NSString *line = [NSString stringWithUTF8String:buffer];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (gApp && line) [gApp handleAgentLine:line];
        });
    }
    return NULL;
}

typedef struct { atomic_uint taps; atomic_uint xp; } Counters;
static Counters app_counters;
static _Atomic uint32_t app_last_pulse_taps;
static _Atomic bool g_flush_scheduled;

// Mirrors of the few settings the tap thread needs: no ObjC on the hot path.
static atomic_bool g_enabled;
static atomic_int g_tap_milli;
static atomic_int g_celebration_milli;
static atomic_int g_system_milli;
static atomic_bool g_release;
static _Atomic uint64_t g_last_key_mach;

// Runs on the CGEventTap thread: classification, one lock-free push, counters.
static void on_key(uint16_t code, bool down, uint64_t host_time) {
    if (!atomic_load(&g_enabled)) return;

    float gain = (float)atomic_load(&g_tap_milli) / 1000.0f;
    if (gain <= 0.001f) return;

    KeyMap m = klick_map_keycode(code);
    float rate = 0.985f + ((float)arc4random_uniform(1000) / 1000.0f) * 0.03f;

    if (down) {
        atomic_store(&g_last_key_mach, host_time);
        audio_trigger(m.role, m.pan, gain, rate, host_time);
        atomic_fetch_add(&app_counters.taps, 1);
        atomic_fetch_add(&app_counters.xp, 1);
        AppDelegate *app = gApp;
        if (app && !atomic_exchange(&g_flush_scheduled, true)) {
            dispatch_async(dispatch_get_main_queue(), ^{
                atomic_store(&g_flush_scheduled, false);
                [app flushStats];
            });
        }
    } else if (atomic_load(&g_release) && m.role != KLICK_ROLE_MODIFIER) {
        audio_trigger(KLICK_ROLE_RELEASE, m.pan, gain * 0.7f, rate, host_time);
    }
}

static NSPoint clamp_to_screen(NSPoint point, CGFloat width, CGFloat height) {
    NSRect visible = [NSScreen mainScreen].visibleFrame;
    point.x = fmax(NSMinX(visible) + 4, fmin(point.x, NSMaxX(visible) - width - 4));
    point.y = fmax(NSMinY(visible) + 4, fmin(point.y, NSMaxY(visible) - height - 4));
    return point;
}

static double num(id value, double fallback) {
    return [value isKindOfClass:[NSNumber class]] ? [value doubleValue] : fallback;
}

static void mirror_settings(NSDictionary *settings) {
    atomic_store(&g_enabled, [settings[@"enabled"] boolValue]);
    atomic_store(&g_tap_milli, (int)lround(num(settings[@"tapVolume"], 0.7) * 1000.0));
    atomic_store(&g_celebration_milli, (int)lround(num(settings[@"celebrationVolume"], 0.7) * 1000.0));
    atomic_store(&g_system_milli, (int)lround(num(settings[@"systemVolume"], 0.7) * 1000.0));
    atomic_store(&g_release, [settings[@"releaseSounds"] boolValue]);
}

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    gApp = self;

    self.packNames = [NSMutableArray array];
    self.packMeta = [NSMutableDictionary dictionary];
    self.logPath = [self supportPath:@"klick.log"];
    [self loadSettings];
    [self setupStatusItem];

    self.packsDir = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"assets/packs"];
    [self loadPackManifest];

    BOOL audioOK = audio_init();
    [self log:@"audio init ok=%d initStatus=%d startStatus=%d running=%d rate=%.0f",
        audioOK, (int)audio_init_status(), (int)audio_start_status(), audio_is_running(), audio_device_rate()];
    [self reloadPacks];

    [self startCapture];

    NSString *cuesDir = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"assets/cues"];
    audio_load_cues(cuesDir.UTF8String);
    [self log:@"cues loaded: %d", audio_load_cues(cuesDir.UTF8String)];

    if ([self.settings[@"buddy"] boolValue]) {
        @try {
            [self showBuddy];
        } @catch (NSException *e) {
            NSLog(@"BUDDY EXCEPTION: %@ — %@", e.name, e.reason);
            [self log:@"buddy failed: %@ — %@", e.name, e.reason];
        }
    }

    @try {
    NSString *sock = [self supportPath:@"agents.sock"];
    pthread_t agentThread;
    const char *sockCopy = strdup(sock.UTF8String);
    if (pthread_create(&agentThread, NULL, agent_listener_thread,
                       (void *)CFBridgingRetain([NSString stringWithUTF8String:sockCopy])) == 0) {
        pthread_detach(agentThread);
        [self log:@"agent socket listening (%@)", sock];
    }
    free((void *)sockCopy);
    [self writeHookShim];
    } @catch (NSException *e) {
        NSLog(@"AGENT EXCEPTION: %@ — %@", e.name, e.reason);
    }

    [[NSWorkspace sharedWorkspace].notificationCenter addObserver:self
        selector:@selector(didWake:) name:NSWorkspaceDidWakeNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
        selector:@selector(screenUnlocked:) name:NSWorkspaceScreensDidWakeNotification object:nil];

    // device changes and periodic work on the main thread
    [NSTimer scheduledTimerWithTimeInterval:1.0 target:self selector:@selector(tick:) userInfo:nil repeats:YES];

    [self log:@"boot (native) version %@ rate=%.0f Hz packs=%d",
        [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"],
        audio_device_rate(), audio_pack_count()];

    NSArray *args = [[NSProcessInfo processInfo] arguments];
    if ([args containsObject:@"--demo"]) {
        [self log:@"demo: 3 taps through the JS bridge"];
        for (int i = 0; i < 3; i++) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((1.5 + i * 0.4) * NSEC_PER_SEC)),
                           dispatch_get_main_queue(), ^{
                atomic_fetch_add(&app_counters.taps, 1);
                atomic_fetch_add(&app_counters.xp, 1);
                [self flushStats];
            });
        }
    }

    if ([args containsObject:@"--selftest"]) {
        [self log:@"selftest: triggering 3 key sounds"];
        for (int i = 0; i < 3; i++) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((0.5 + i * 0.25) * NSEC_PER_SEC)),
                           dispatch_get_main_queue(), ^{
                audio_trigger(KLICK_ROLE_KEYS, 0, 0.7f, 1.0f, mach_absolute_time());
            });
        }
    }

    BOOL forceSettings = [args containsObject:@"--settings"];
    if (forceSettings || ![self.settings[@"onboarded"] boolValue]) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.35 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{ [self openSettings:nil]; });
    }
}

- (void)applicationWillTerminate:(NSNotification *)note {
    [self saveSettings];
    klick_capture_stop();
    audio_shutdown();
}

// ------------------------------------------------------------- lifecycle

- (void)didWake:(NSNotification *)note {
    [self log:@"woke from sleep — recovering capture and audio"];
    klick_capture_recover();
    audio_reload_for_device();
    [self reloadPacks];
    self.captureOK = klick_capture_has_permission() && YES;
}

- (void)screenUnlocked:(NSNotification *)note {
    klick_capture_recover();
}

- (void)tick:(NSTimer *)timer {
    if (audio_take_reconfigure_flag()) {
        [self log:@"output device changed — reinitialising CoreAudio"];
        audio_reload_for_device();
        [self reloadPacks];
    }
    [self flushCountersIfNeeded];
    [self pushStatusToWeb];
    [self pushStats:[self statsPayload]];

    static unsigned long lastVoices = 0;
    unsigned long voices = audio_voice_count();
    if (voices != lastVoices) {
        lastVoices = voices;
        [self log:@"audio voices started: %lu (render slices %lu, latency %.2f ms)",
            voices, audio_render_count(), audio_latency_ms()];
    }

    static BOOL loggedRender = NO;
    if (!loggedRender && audio_render_count() > 0) {
        loggedRender = YES;
        [self log:@"audio render callback running (%lu slices)", audio_render_count()];
    }

    BOOL healthy = klick_capture_is_running();
    if (healthy != self.captureOK) {
        self.captureOK = healthy;
        [self log:@"capture %@", healthy ? @"running" : @"lost (permission revoked?)"];
        [self pushStatusToWeb];
    }

    // permission can be granted while the app is open: retry every 2 seconds
    static time_t lastCaptureTry = 0;
    time_t now = time(NULL);
    if (!self.captureOK && now - lastCaptureTry >= 2) {
        lastCaptureTry = now;
        if (klick_capture_has_permission()) {
            self.captureOK = klick_capture_start(on_key);
            [self log:@"capture %@ after permission change", self.captureOK ? @"started" : @"failed"];
            [self pushStatusToWeb];
        }
    }

    static BOOL loggedLatency = NO;
    if (!loggedLatency && audio_latency_ms() > 0) {
        loggedLatency = YES;
        double bufferMs = (64.0 / (audio_device_rate() > 0 ? audio_device_rate() : 48000.0)) * 1000.0;
        [self log:@"measured latency %.2f ms (tap->render), device buffer %.2f ms @ %.0f Hz",
            audio_latency_ms(), bufferMs, audio_device_rate()];
    }
}

// ------------------------------------------------------------------ paths

- (NSString *)supportDir {
    NSString *dir = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory,
        NSUserDomainMask, YES).firstObject stringByAppendingPathComponent:@"Klick"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    return dir;
}

- (NSString *)supportPath:(NSString *)name {
    return [[self supportDir] stringByAppendingPathComponent:name];
}

- (void)log:(NSString *)format, ... {
    va_list args;
    va_start(args, format);
    NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
    va_end(args);

    NSISO8601DateFormatter *stamp = [[NSISO8601DateFormatter alloc] init];
    NSString *line = [NSString stringWithFormat:@"%@ %@\n", [stamp stringFromDate:[NSDate date]], message];
    NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:self.logPath];
    if (!handle) {
        [data writeToFile:self.logPath atomically:YES];
    } else {
        @try { [handle seekToEndOfFile]; [handle writeData:data]; } @catch (NSException *e) {}
        [handle closeFile];
    }
    NSLog(@"%@", message);
}

// --------------------------------------------------------------- settings

- (void)loadSettings {
    NSString *path = [self supportPath:@"settings.json"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSDictionary *stored = nil;
    if (data) stored = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];

    NSMutableDictionary *defaults = [@{
        @"enabled": @YES,
        @"pack": @"laptop",
        @"volume": @0.7,
        @"tapVolume": @0.7,
        @"celebrationVolume": @0.7,
        @"systemVolume": @0.7,
        @"releaseSounds": @YES,
        @"mouseClicks": @YES,
        @"launchAtLogin": @NO,
        @"onboarded": @NO,
        @"taps": @0,
        @"xp": @0
    } mutableCopy];
    if (stored) {
        [defaults addEntriesFromDictionary:stored];
        // migrate the old single volume once
        if (!stored[@"tapVolume"]) {
            NSNumber *legacy = stored[@"volume"] ?: @0.7;
            defaults[@"tapVolume"] = legacy;
            defaults[@"celebrationVolume"] = legacy;
            defaults[@"systemVolume"] = legacy;
        }
    }
    // JSON nulls from older builds must never reach a numeric read
    for (NSString *key in [defaults allKeys]) {
        if ([defaults[key] isKindOfClass:[NSNull class]]) [defaults removeObjectForKey:key];
    }
    self.settings = defaults;
    mirror_settings(self.settings);
    atomic_store(&app_counters.taps, [self.settings[@"taps"] unsignedIntValue]);
    atomic_store(&app_counters.xp, [self.settings[@"xp"] unsignedIntValue]);
    // start the milestone window at the current count: no celebration on launch
    atomic_store(&app_last_pulse_taps, atomic_load(&app_counters.taps));
}

- (void)saveSettings {
    mirror_settings(self.settings);
    self.settings[@"taps"] = @(atomic_load(&app_counters.taps));
    self.settings[@"xp"] = @(atomic_load(&app_counters.xp));
    self.settings[@"pack"] = self.packNames.count > self.activePack ? self.packNames[self.activePack] : @"laptop";
    NSData *json = [NSJSONSerialization dataWithJSONObject:self.settings options:NSJSONWritingPrettyPrinted error:nil];
    [json writeToFile:[self supportPath:@"settings.json"] atomically:YES];
}

- (void)flushCountersIfNeeded {
    static time_t lastFlush = 0;
    time_t now = time(NULL);
    if (now - lastFlush < 5) return;
    lastFlush = now;
    [self saveSettings];
}

// ------------------------------------------------------------------ audio

- (void)loadPackManifest {
    NSString *path = [self.packsDir stringByAppendingPathComponent:@"manifest.json"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data) return;
    NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    for (NSDictionary *pack in json[@"packs"] ?: @[]) {
        if (pack[@"id"]) self.packMeta[pack[@"id"]] = pack;
    }
    [self log:@"pack manifest: %lu entries", (unsigned long)self.packMeta.count];
}

- (NSString *)displayNameForPack:(NSString *)packId {
    NSDictionary *meta = self.packMeta[packId];
    return meta[@"name"] ?: [packId capitalizedString];
}

- (void)reloadPacks {
    int count = audio_load_packs(self.packsDir.UTF8String);
    [self.packNames removeAllObjects];
    for (int i = 0; i < count; i++) {
        [self.packNames addObject:[NSString stringWithUTF8String:audio_pack_name(i)]];
    }

    NSString *wanted = self.settings[@"pack"];
    NSUInteger index = [self.packNames indexOfObject:wanted];
    if (index == NSNotFound) index = 0;
    self.activePack = (int)index;
    audio_select_pack(self.activePack);
    [self log:@"pack select: wanted=%@ index=%ld of %lu", wanted ?: @"(nil)", (long)index, (unsigned long)self.packNames.count];
    [self rebuildMenu];
    [self log:@"packs loaded: %d, active: %@", count, self.packNames.count ? self.packNames[index] : @"none"];
}

// --------------------------------------------------------------- capture

- (void)startCapture {
    if (klick_capture_has_permission()) {
        self.captureOK = klick_capture_start(on_key);
        [self log:@"capture %@", self.captureOK ? @"running" : @"failed to start"];
    } else {
        self.captureOK = NO;
        [self log:@"waiting for Input Monitoring"];
        klick_capture_start(on_key);   // raises the one-time system prompt
    }
}

// ------------------------------------------------------------------- menu

- (void)setupStatusItem {
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:24];
    NSImage *icon = [NSImage imageNamed:@"trayTemplate"];
    if (!icon) {
        NSString *path = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"assets/trayTemplate.png"];
        icon = [[NSImage alloc] initWithContentsOfFile:path];
    }
    icon.template = YES;
    icon.size = NSMakeSize(18, 18);
    self.statusItem.button.image = icon;
    [self rebuildMenu];
}

- (void)rebuildMenu {
    NSMenu *menu = [[NSMenu alloc] init];

    NSMenuItem *toggle = [[NSMenuItem alloc] initWithTitle:([self.settings[@"enabled"] boolValue] ? @"Sounds on" : @"Sounds off")
                                                   action:@selector(toggleSounds:) keyEquivalent:@""];
    toggle.state = [self.settings[@"enabled"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    [menu addItem:toggle];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *volumeItem = [[NSMenuItem alloc] initWithTitle:@"Volume" action:nil keyEquivalent:@""];
    NSMenu *volumeMenu = [[NSMenu alloc] init];
    for (NSNumber *level in @[@0.25, @0.5, @0.75, @1.0]) {
        NSString *title = [NSString stringWithFormat:@"%.0f%%", level.doubleValue * 100];
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(setVolume:) keyEquivalent:@""];
        item.representedObject = level;
        item.state = fabs(num(self.settings[@"tapVolume"], 0.7) - level.doubleValue) < 0.01 ? NSControlStateValueOn : NSControlStateValueOff;
        [volumeMenu addItem:item];
    }
    volumeItem.submenu = volumeMenu;
    [menu addItem:volumeItem];

    NSMenuItem *packItem = [[NSMenuItem alloc] initWithTitle:@"Sound" action:nil keyEquivalent:@""];
    NSMenu *packMenu = [[NSMenu alloc] init];
    [self.packNames enumerateObjectsUsingBlock:^(NSString *name, NSUInteger index, BOOL *stop) {
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:[self displayNameForPack:name]
                                                     action:@selector(selectPack:) keyEquivalent:@""];
        item.tag = (NSInteger)index;
        item.state = ((int)index == self.activePack) ? NSControlStateValueOn : NSControlStateValueOff;
        [packMenu addItem:item];
    }];
    packItem.submenu = packMenu;
    [menu addItem:packItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *login = [[NSMenuItem alloc] initWithTitle:@"Launch at Login" action:@selector(toggleLaunchAtLogin:) keyEquivalent:@""];
    login.state = [self launchAtLoginEnabled] ? NSControlStateValueOn : NSControlStateValueOff;
    [menu addItem:login];

    NSMenuItem *kiki = [[NSMenuItem alloc] initWithTitle:@"Kiki on the desktop" action:@selector(toggleBuddy:) keyEquivalent:@""];
    kiki.state = [self.settings[@"buddy"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    [menu addItem:kiki];

    NSMenuItem *settingsItem = [[NSMenuItem alloc] initWithTitle:@"Settings…" action:@selector(openSettings:) keyEquivalent:@","];
    [menu addItem:settingsItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Klick" action:@selector(quit:) keyEquivalent:@"q"];
    [menu addItem:quit];

    self.statusItem.menu = menu;
    [self log:@"menu rebuilt: %lu packs, kiki %@", (unsigned long)self.packNames.count,
        [self.settings[@"buddy"] boolValue] ? @"on" : @"off"];
}

- (void)toggleSounds:(NSMenuItem *)item {
    self.settings[@"enabled"] = @(![self.settings[@"enabled"] boolValue]);
    [self rebuildMenu];
    [self saveSettings];
    [self pushSettingsToWeb];
}

- (void)setVolume:(NSMenuItem *)item {
    self.settings[@"volume"] = item.representedObject;
    self.settings[@"tapVolume"] = item.representedObject;
    self.settings[@"celebrationVolume"] = item.representedObject;
    self.settings[@"systemVolume"] = item.representedObject;
    [self rebuildMenu];
    [self saveSettings];
    [self pushSettingsToWeb];
}

- (void)selectPack:(NSMenuItem *)item {
    self.activePack = (int)item.tag;
    audio_select_pack(self.activePack);
    [self rebuildMenu];
    [self saveSettings];
    [self pushSettingsToWeb];
}

- (void)toggleLaunchAtLogin:(NSMenuItem *)item {
    if (@available(macOS 13.0, *)) {
        NSError *error = nil;
        SMAppService *service = SMAppService.mainAppService;
        if (service.status == SMAppServiceStatusEnabled) [service unregisterAndReturnError:&error];
        else [service registerAndReturnError:&error];
        if (error) [self log:@"launch at login failed: %@", error.localizedDescription];
        self.settings[@"launchAtLogin"] = @([self launchAtLoginEnabled]);
        [self rebuildMenu];
        [self saveSettings];
        [self pushSettingsToWeb];
    }
}

- (BOOL)launchAtLoginEnabled {
    if (@available(macOS 13.0, *)) return SMAppService.mainAppService.status == SMAppServiceStatusEnabled;
    return NO;
}

- (void)quit:(id)sender {
    [self saveSettings];
    [NSApp terminate:nil];
}

// --------------------------------------------------------------- settings UI

- (void)openSettings:(id)sender {
    if (self.settingsWindow) {
        [self.settingsWindow makeKeyAndOrderFront:nil];
        [NSApp activateIgnoringOtherApps:YES];
        return;
    }

    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 880, 640)
                                                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                                             NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                                                    backing:NSBackingStoreBuffered defer:NO];
    window.title = @"Klick";
    window.delegate = self;
    window.releasedWhenClosed = NO;
    [window center];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    NSString *bridge = [NSString stringWithContentsOfFile:[[NSBundle mainBundle].resourcePath
        stringByAppendingPathComponent:@"web/bridge.js"] encoding:NSUTF8StringEncoding error:nil];
    WKUserScript *script = [[WKUserScript alloc] initWithSource:bridge
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];
    [config.userContentController addUserScript:script];
    [config.userContentController addScriptMessageHandler:self name:@"klick"];

    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds configuration:config];
    web.navigationDelegate = self;
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    window.contentView = web;

    NSString *html = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web/settings.html"];
    NSURL *url = [NSURL fileURLWithPath:html];

    NSString *webRoot = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web"];
    [web loadFileURL:url allowingReadAccessToURL:[NSURL fileURLWithPath:webRoot]];

    self.settingsWindow = window;
    self.webView = web;
    [self log:@"settings window opened"];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)writeHookShim {
    NSString *binDir = [[self supportPath:@"bin"] stringByStandardizingPath];
    [[NSFileManager defaultManager] createDirectoryAtPath:binDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *shim = [binDir stringByAppendingPathComponent:@"klick-hook"];
    NSString *body = [NSString stringWithFormat:@"#!/bin/sh\nexec \"%@\" --hook \"$@\"\n",
                      [NSBundle mainBundle].executablePath];
    [body writeToFile:shim atomically:YES encoding:NSUTF8StringEncoding error:nil];
    [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0755}
                                     ofItemAtPath:shim error:nil];
}

- (void)handleAgentLine:(NSString *)line {
    NSString *event = @"done";
    if ([line rangeOfString:@"needs-you"].location != NSNotFound) event = @"needs-you";
    else if ([line rangeOfString:@"error"].location != NSNotFound) event = @"error";

    float gain = fmaxf(0.02f, (float)atomic_load(&g_system_milli) / 1000.0f);
    if ([event isEqualToString:@"error"]) {
        audio_trigger_cue(1, gain);
        [self buddyMood:@"error"];
    } else if ([event isEqualToString:@"needs-you"]) {
        audio_trigger(KLICK_ROLE_KEYS, -0.2f, gain, 1.0f, mach_absolute_time());
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.12 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{ audio_trigger(KLICK_ROLE_KEYS, 0.2f, gain, 1.335f, mach_absolute_time()); });
        [self buddyMood:@"sweat"];
    } else {
        audio_trigger_cue(0, gain);
        [self buddyMood:@"happy"];
    }
    [self log:@"agent event: %@", event];
}

- (void)showBuddy {
    if (self.buddyPanel) { [self.buddyPanel orderFrontRegardless]; return; }

    NSRect visible = [NSScreen mainScreen].visibleFrame;
    CGFloat width = 172, height = 196;
    CGFloat x = num(self.settings[@"buddyX"], 0);
    CGFloat y = num(self.settings[@"buddyY"], 0);
    if (x <= 0 && y <= 0) {
        x = NSMaxX(visible) - width - 36;
        y = NSMinY(visible) + 56;
    }

    NSPoint clamped = clamp_to_screen(NSMakePoint(x, y), width, height);
    x = clamped.x; y = clamped.y;

    NSPanel *panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(x, y, width, height)
        styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
        backing:NSBackingStoreBuffered defer:NO];
    panel.opaque = NO;
    panel.backgroundColor = [NSColor clearColor];
    panel.hasShadow = NO;
    panel.level = NSFloatingWindowLevel;
    panel.hidesOnDeactivate = NO;
    panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary;
    panel.ignoresMouseEvents = NO;

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    NSString *bridge = [NSString stringWithContentsOfFile:[[NSBundle mainBundle].resourcePath
        stringByAppendingPathComponent:@"web/bridge.js"] encoding:NSUTF8StringEncoding error:nil];
    [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:bridge
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [config.userContentController addScriptMessageHandler:self name:@"klick"];

    WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, width, height) configuration:config];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    @try { [web setValue:@NO forKey:@"drawsBackground"]; } @catch (NSException *e) {}

    web.navigationDelegate = self;
    panel.contentView = web;
    NSString *root = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web"];
    NSURL *url = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"buddy.html"]];
    [web loadFileURL:url allowingReadAccessToURL:[NSURL fileURLWithPath:root]];
    [panel orderFrontRegardless];

    self.buddyPanel = panel;
    self.buddyWeb = web;
    if ([self.settings[@"showTapCounter"] boolValue] != false) [self showCounter];
    [self log:@"buddy panel shown at %.0f,%.0f", x, y];
}

- (void)showCounter {
    if (!self.counterPanel) {
        NSRect visible = [NSScreen mainScreen].visibleFrame;
        CGFloat width = 104, height = 62;
        CGFloat buddyX = self.buddyPanel ? NSMinX(self.buddyPanel.frame) : num(self.settings[@"buddyX"], 0);
        CGFloat buddyY = self.buddyPanel ? NSMinY(self.buddyPanel.frame) : num(self.settings[@"buddyY"], 0);
        if (buddyX <= 0 && buddyY <= 0) {
            buddyX = NSMaxX(visible) - 152 - 36;
            buddyY = NSMinY(visible) + 56;
        }
        CGFloat x = num(self.settings[@"counterX"], 0);
        CGFloat y = num(self.settings[@"counterY"], 0);
        if (x <= 0 && y <= 0) {   // start right beside Kiki
            x = buddyX + 152 + 8;
            y = buddyY + (152 - height) / 2.0;
        }

        NSPoint clamped = clamp_to_screen(NSMakePoint(x, y), width, height);
    x = clamped.x; y = clamped.y;

    NSPanel *panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(x, y, width, height)
            styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
            backing:NSBackingStoreBuffered defer:NO];
        panel.opaque = NO;
        panel.backgroundColor = [NSColor clearColor];
        panel.hasShadow = NO;
        panel.level = NSFloatingWindowLevel;
        panel.hidesOnDeactivate = NO;
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary;

        WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
        config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
        NSString *bridge = [NSString stringWithContentsOfFile:[[NSBundle mainBundle].resourcePath
            stringByAppendingPathComponent:@"web/bridge.js"] encoding:NSUTF8StringEncoding error:nil];
        [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:bridge
            injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
        [config.userContentController addScriptMessageHandler:self name:@"klick"];

        WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, width, height) configuration:config];
        web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        web.navigationDelegate = self;
        @try { [web setValue:@NO forKey:@"drawsBackground"]; } @catch (NSException *e) {}
        panel.contentView = web;

        NSString *root = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web"];
        NSURL *url = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"counter.html"]];
        [web loadFileURL:url allowingReadAccessToURL:[NSURL fileURLWithPath:root]];
        [panel orderFrontRegardless];

        self.counterPanel = panel;
        self.counterWeb = web;
        [self log:@"tap counter shown at %.0f,%.0f", x, y];
    } else {
        [self.counterPanel orderFrontRegardless];
    }
}

- (void)hideCounter {
    [self.counterPanel orderOut:nil];
    self.counterPanel = nil;
    self.counterWeb = nil;
}

- (void)hideBuddy {
    [self.buddyPanel orderOut:nil];
    self.buddyPanel = nil;
    self.buddyWeb = nil;
    [self hideCounter];
    [self log:@"buddy panel hidden"];
}

- (NSDictionary *)statsPayload {
    uint32_t taps = atomic_load(&app_counters.taps);
    uint32_t xp = atomic_load(&app_counters.xp);
    int level = klick_level_for(xp);
    const char *hat = klick_hat_for(level);
    return @{ @"taps": @(taps), @"xp": @(xp), @"level": @(level),
              @"hat": hat ? @(hat) : [NSNull null] };
}

- (void)pushStats:(NSDictionary *)payload {
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:NSJSONWritingFragmentsAllowed error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    if (!text) return;
    if (self.webView) {
        NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('stats', %@)", text];
        [self.webView evaluateJavaScript:js completionHandler:^(id r, NSError *e) {
            if (e) [self log:@"stats eval error: %@", e.localizedDescription];
        }];
    }
    if (self.buddyWeb) {
        NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('stats', %@)", text];
        [self.buddyWeb evaluateJavaScript:js completionHandler:nil];
    }
    if (self.counterWeb) {
        NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('stats', %@)", text];
        [self.counterWeb evaluateJavaScript:js completionHandler:nil];
    }
}

- (void)flushStats {
    uint32_t now = atomic_load(&app_counters.taps);
    uint32_t before = atomic_exchange(&app_last_pulse_taps, now);
    uint32_t every = (uint32_t)num(self.settings[@"celebrateEvery"], 100);
    uint32_t milestone = klick_milestone_crossed(before, now, every);

    [self pushStats:[self statsPayload]];

    if (self.buddyWeb) {
        NSMutableDictionary *payload = [[self statsPayload] mutableCopy];
        payload[@"milestone"] = @(milestone);
        NSData *json = [NSJSONSerialization dataWithJSONObject:payload
                                                       options:NSJSONWritingFragmentsAllowed error:nil];
        NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('press', %@)", text];
        [self.buddyWeb evaluateJavaScript:js completionHandler:nil];
    }

    if (milestone > 0) {
        [self log:@"milestone %u taps", milestone];
        audio_trigger_cue_rate(0, fmaxf(0.02f, (float)atomic_load(&g_celebration_milli) / 1000.0f), 1.18f);
        [self buddyMood:@"party"];
    }
}

- (void)buddyPulse {
    if (!self.buddyWeb) return;

    uint32_t before = atomic_load(&app_last_pulse_taps);
    uint32_t now = atomic_load(&app_counters.taps);
    atomic_store(&app_last_pulse_taps, now);

    uint32_t every = (uint32_t)num(self.settings[@"celebrateEvery"], 100);
    uint32_t milestone = klick_milestone_crossed(before, now, every);

    NSMutableDictionary *payload = [[self statsPayload] mutableCopy];
    payload[@"milestone"] = @(milestone);

    NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:NSJSONWritingFragmentsAllowed error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    if (!text) return;
    NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('press', %@)", text];
    [self.buddyWeb evaluateJavaScript:js completionHandler:nil];

    if (milestone > 0) {
        [self log:@"milestone %u taps", milestone];
        audio_trigger_cue_rate(0, fmaxf(0.02f, (float)atomic_load(&g_celebration_milli) / 1000.0f), 1.18f);
        [self buddyMood:@"party"];
    }
}

- (void)buddyMood:(NSString *)mood {
    NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('mood', %@)", [self jsonQuote:mood]];
    [self.buddyWeb evaluateJavaScript:js completionHandler:nil];
}

- (void)toggleBuddy:(NSMenuItem *)item {
    BOOL on = ![self.settings[@"buddy"] boolValue];
    self.settings[@"buddy"] = @(on);
    if (on) [self showBuddy]; else [self hideBuddy];
    [self saveSettings];
    [self rebuildMenu];
    [self pushSettingsToWeb];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (webView == self.counterWeb) {
        [self log:@"counter page loaded"];
        NSData *stats = [NSJSONSerialization dataWithJSONObject:[self statsPayload]
                                                        options:NSJSONWritingFragmentsAllowed error:nil];
        NSString *text = [[NSString alloc] initWithData:stats encoding:NSUTF8StringEncoding];
        [webView evaluateJavaScript:[NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('stats', %@)", text]
                  completionHandler:nil];
        return;
    }
    if (webView == self.buddyWeb) {
        [self log:@"buddy page loaded"];
        NSData *settings = [NSJSONSerialization dataWithJSONObject:self.settings
                                                           options:NSJSONWritingFragmentsAllowed error:nil];
        NSData *stats = [NSJSONSerialization dataWithJSONObject:[self statsPayload]
                                                        options:NSJSONWritingFragmentsAllowed error:nil];
        NSString *s1 = [[NSString alloc] initWithData:settings encoding:NSUTF8StringEncoding];
        NSString *s2 = [[NSString alloc] initWithData:stats encoding:NSUTF8StringEncoding];
        NSString *js = [NSString stringWithFormat:
            @"window.__klickEvent && (window.__klickEvent('settings', %@), window.__klickEvent('stats', %@))",
            s1, s2];
        [webView evaluateJavaScript:js completionHandler:nil];
        [webView evaluateJavaScript:@"[typeof window.__klickEvent, typeof window.klick.debug, typeof window.klick.onStats, document.getElementById('tapPill') ? 'pill-ok' : 'pill-missing'].join('|')"
                   completionHandler:^(id result, NSError *error) {
            [self log:@"buddy probe: %@ %@", result ?: @"nil", error ? error.localizedDescription : @""];
        }];
        return;
    }
    if (webView != self.webView) return;
    [self log:@"settings page loaded"];
    [webView evaluateJavaScript:@"window.__klickEvent ? 'bridge-ok' : 'bridge-missing'"
              completionHandler:^(id result, NSError *error) {
        [self log:@"bridge probe: %@ %@", result ?: @"nil", error ? error.localizedDescription : @""];
    }];
    if (![self.settings[@"onboarded"] boolValue]) {
        [self pushEvent:@"onboarding" payload:@{}];
    }
    [self pushStats:[self statsPayload]];
}

- (void)windowWillClose:(NSNotification *)note {
    if (note.object == self.settingsWindow) {
        // lazy: drop the whole web view so idle RAM stays small
        [self.webView.configuration.userContentController removeScriptMessageHandlerForName:@"klick"];
        self.webView = nil;
        self.settingsWindow = nil;
    }
}

// ------------------------------------------------------------------ bridge

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *body = message.body;
    NSString *ident = body[@"id"] ?: @"";
    NSString *method = body[@"method"] ?: @"";
    NSDictionary *args = [body[@"args"] isKindOfClass:[NSDictionary class]] ? body[@"args"] : @{};

    id result = [self handleMethod:method args:args];
    if (!result) result = [NSNull null];
    NSError *jsonError = nil;
    // scalars (bools, strings) are only legal with the fragments flag
    NSData *json = [NSJSONSerialization dataWithJSONObject:result
                                                   options:NSJSONWritingFragmentsAllowed
                                                     error:&jsonError];
    if (!json) {
        [self log:@"bridge: cannot encode reply for %@ (%@)", method, jsonError.localizedDescription];
        json = [@"null" dataUsingEncoding:NSUTF8StringEncoding];
    }
    NSString *payload = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__klickResolve(%@, %@)",
                    [self jsonQuote:ident], payload ?: @"null"];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (NSString *)jsonQuote:(NSString *)value {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@[value ?: @""] options:0 error:nil];
    NSString *array = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return [array substringWithRange:NSMakeRange(1, array.length - 2)];
}

- (id)handleMethod:(NSString *)method args:(NSDictionary *)args {
    if ([method isEqualToString:@"getSettings"]) return self.settings;
    if ([method isEqualToString:@"appInfo"]) {
        NSString *arch = @"arm64";
#if defined(__x86_64__)
        arch = @"x86_64";
#endif
        return @{ @"version": [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"0.4.0",
                  @"runtime": [NSString stringWithFormat:@"Native macOS · CoreAudio · WKWebView (%@)", arch],
                  @"electron": @"—", @"chrome": @"—", @"node": @"—",
                  @"platform": @"darwin", @"arch": arch };
    }
    if ([method isEqualToString:@"captureInfo"]) {
        uint64_t last = atomic_load(&g_last_key_mach);
        double ageMs = 0;
        if (last) {
            mach_timebase_info_data_t tb;
            mach_timebase_info(&tb);
            ageMs = ((double)(mach_absolute_time() - last) * tb.numer / tb.denom) / 1e6;
        }
        double nowMs = [[NSDate date] timeIntervalSince1970] * 1000.0;
        BOOL healthy = klick_capture_is_running();
        return @{ @"ok": @(healthy), @"reason": healthy ? [NSNull null] : @"permission",
                  @"lastKeyAt": last ? @(nowMs - ageMs) : [NSNull null],
                  @"keysToday": @(atomic_load(&app_counters.taps)),
                  @"packs": @(self.packNames.count) };
    }
    if ([method isEqualToString:@"hookStatus"]) {
        BOOL healthy = klick_capture_is_running();
        return @{ @"ok": @(healthy), @"platform": @"darwin",
                  @"reason": healthy ? [NSNull null] : @"permission" };
    }
    if ([method isEqualToString:@"latency"]) {
        double deviceMs = (64.0 / (audio_device_rate() > 0 ? audio_device_rate() : 48000.0)) * 1000.0;
        return @{ @"baseMs": @(deviceMs), @"outputMs": @0,
                  @"handlingMs": @(audio_latency_ms()), @"state": @"running" };
    }
    if ([method isEqualToString:@"packs"]) {
        NSMutableArray *list = [NSMutableArray array];
        for (NSString *packId in self.packNames) {
            NSDictionary *meta = self.packMeta[packId];
            [list addObject:@{
                @"id": packId,
                @"name": meta[@"name"] ?: [packId capitalizedString],
                @"vibe": meta[@"vibe"] ?: @"",
                @"category": meta[@"category"] ?: @"Mechanical"
            }];
        }
        return list;
    }
    if ([method isEqualToString:@"audition"]) {
        NSString *packId = args[@"pack"] ?: nil;
        if (packId) {
            NSUInteger index = [self.packNames indexOfObject:packId];
            if (index != NSNotFound) { self.activePack = (int)index; audio_select_pack(self.activePack); }
        }
        float gain = fmaxf(0.05f, (float)atomic_load(&g_tap_milli) / 1000.0f);
        for (int i = 0; i < 3; i++) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(i * 0.13 * NSEC_PER_SEC)),
                           dispatch_get_main_queue(), ^{
                audio_trigger(i == 2 ? KLICK_ROLE_SPACE : KLICK_ROLE_KEYS, 0, gain, 1.0f, mach_absolute_time());
            });
        }
        return @YES;
    }
    if ([method isEqualToString:@"stats"]) {
        return @{ @"taps": @(atomic_load(&app_counters.taps)), @"xp": @(atomic_load(&app_counters.xp)),
                  @"slaps": @0, @"level": @1, @"hat": [NSNull null], @"day": @"" };
    }
    if ([method isEqualToString:@"agents"]) {
        NSString *claude = [@"~/.claude/settings.json" stringByExpandingTildeInPath];
        NSData *data = [NSData dataWithContentsOfFile:claude];
        BOOL installed = NO;
        if (data) {
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            installed = json[@"hooks"] != nil;
        }
        return @{ @"claude": @{ @"installed": @(installed), @"events": @[@"done", @"needs-you", @"error"] } };
    }
    if ([method isEqualToString:@"connectAgent"] || [method isEqualToString:@"removeAgent"]) {
        NSString *agent = args[@"agent"] ?: @"";
        if (![agent isEqualToString:@"claude"]) {
            return @{ @"ok": @NO, @"error": @"Cursor and Codex hooks arrive in the next build" };
        }
        BOOL connect = [method isEqualToString:@"connectAgent"];
        return [self updateClaudeHooks:connect];
    }
    if ([method isEqualToString:@"cueSamples"]) return @{ @"done": [NSNull null], @"error": [NSNull null] };
    if ([method isEqualToString:@"onboarded"]) { self.settings[@"onboarded"] = @YES; [self saveSettings]; return @YES; }
    if ([method isEqualToString:@"resetTaps"]) {
        atomic_store(&app_counters.taps, 0);
        atomic_store(&app_last_pulse_taps, 0);
        atomic_store(&g_flush_scheduled, false);
        [self saveSettings];
        NSDictionary *stats = [self statsPayload];
        [self pushStats:stats];
        [self log:@"taps reset to 0"];
        return stats;
    }
    if ([method isEqualToString:@"previewSound"]) {
        NSString *kind = args[@"kind"] ?: @"tap";
        if ([kind isEqualToString:@"celebration"]) {
            audio_trigger_cue_rate(0, fmaxf(0.02f, (float)atomic_load(&g_celebration_milli) / 1000.0f), 1.18f);
        } else if ([kind isEqualToString:@"system"]) {
            audio_trigger_cue(0, fmaxf(0.02f, (float)atomic_load(&g_system_milli) / 1000.0f));
        } else {
            audio_trigger(KLICK_ROLE_KEYS, 0, fmaxf(0.02f, (float)atomic_load(&g_tap_milli) / 1000.0f), 1.0f, mach_absolute_time());
        }
        return @YES;
    }
    if ([method isEqualToString:@"demoTap"]) {
        [self log:@"demo tap"];
        audio_trigger(KLICK_ROLE_KEYS, 0, fmaxf(0.05f, (float)atomic_load(&g_tap_milli) / 1000.0f), 1.0f, mach_absolute_time());
        atomic_fetch_add(&app_counters.taps, 1);
        return @YES;
    }
    if ([method isEqualToString:@"setSettings"]) {
        NSDictionary *patch = args[@"patch"];
        if ([patch isKindOfClass:[NSDictionary class]]) {
            [self.settings addEntriesFromDictionary:patch];
            if (patch[@"showTapCounter"]) {
                if ([patch[@"showTapCounter"] boolValue]) { [self showCounter]; } else { [self hideCounter]; }
            }
            if (patch[@"pack"]) {
                NSUInteger index = [self.packNames indexOfObject:patch[@"pack"]];
                if (index != NSNotFound) { self.activePack = (int)index; audio_select_pack(self.activePack); }
            }
            [self saveSettings];
            [self rebuildMenu];
            [self pushSettingsToWeb];
        }
        return self.settings;
    }
    if ([method isEqualToString:@"jslog"]) {
        [self log:@"js: %@", args[@"message"] ?: @""];
        return @YES;
    }
    if ([method isEqualToString:@"slap"]) {
        float gain = fmaxf(0.05f, (float)atomic_load(&g_tap_milli) / 1000.0f);
        audio_trigger(KLICK_ROLE_KEYS, 0.0f, gain, 0.80f, mach_absolute_time());
        atomic_fetch_add(&app_counters.xp, 10);
        atomic_fetch_add(&app_counters.taps, 1);
        [self buddyMood:@"party"];
        [self pushStats:[self statsPayload]];
        [self log:@"kiki slapped (+10 xp)"];
        [self saveSettings];
        return @YES;
    }
    if ([method isEqualToString:@"buddyMove"]) {
        CGFloat dx = [args[@"dx"] doubleValue];
        CGFloat dy = [args[@"dy"] doubleValue];
        NSRect frame = self.buddyPanel.frame;
        frame.origin.x += dx;
        frame.origin.y -= dy;
        [self.buddyPanel setFrameOrigin:frame.origin];
        return @YES;
    }
    if ([method isEqualToString:@"counterMove"]) {
        CGFloat dx = [args[@"dx"] doubleValue];
        CGFloat dy = [args[@"dy"] doubleValue];
        NSRect frame = self.counterPanel.frame;
        frame.origin.x += dx;
        frame.origin.y -= dy;
        [self.counterPanel setFrameOrigin:frame.origin];
        return @YES;
    }
    if ([method isEqualToString:@"counterEnd"]) {
        NSPoint origin = self.counterPanel.frame.origin;
        self.settings[@"counterX"] = @(origin.x);
        self.settings[@"counterY"] = @(origin.y);
        [self saveSettings];
        [self log:@"counter moved to %.0f,%.0f", origin.x, origin.y];
        return @YES;
    }
    if ([method isEqualToString:@"buddyEnd"]) {
        NSPoint origin = self.buddyPanel.frame.origin;
        self.settings[@"buddyX"] = @(origin.x);
        self.settings[@"buddyY"] = @(origin.y);
        [self saveSettings];
        [self log:@"kiki moved to %.0f,%.0f", origin.x, origin.y];
        return @YES;
    }
    if ([method isEqualToString:@"openPrivacy"]) {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:
            @"x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"]];
        return @YES;
    }
    if ([method isEqualToString:@"revealLog"]) {
        [[NSWorkspace sharedWorkspace] selectFile:self.logPath inFileViewerRootedAtPath:@""];
        return @YES;
    }
    if ([method isEqualToString:@"quit"]) { [self quit:nil]; return @YES; }
    if ([method isEqualToString:@"openLink"]) {
        [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:args[@"url"] ?: @""]];
        return @YES;
    }
    if ([method isEqualToString:@"samples"]) {
        NSString *pack = args[@"pack"] ?: @"";
        return [self sampleDataForPack:pack];
    }
    return [NSNull null];
}

- (NSDictionary *)sampleDataForPack:(NSString *)pack {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSString *dir = [self.packsDir stringByAppendingPathComponent:pack];
    NSArray *files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil];
    for (NSString *file in files) {
        if (![file.pathExtension isEqualToString:@"wav"]) continue;
        NSString *role = [[file stringByDeletingPathExtension] componentsSeparatedByString:@"-"][0];
        NSData *data = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:file]];
        if (!data) continue;
        NSMutableArray *takes = result[role] ?: [NSMutableArray array];
        if (takes.count < 6) [takes addObject:[data base64EncodedStringWithOptions:0]];
        result[role] = takes;
    }
    return result;
}

- (NSDictionary *)updateClaudeHooks:(BOOL)connect {
    NSString *path = [@"~/.claude/settings.json" stringByExpandingTildeInPath];
    [[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
                              withIntermediateDirectories:YES attributes:nil error:nil];

    NSData *data = [NSData dataWithContentsOfFile:path];
    NSMutableDictionary *json = data ? [[NSJSONSerialization JSONObjectWithData:data options:0 error:nil] mutableCopy]
                                     : [NSMutableDictionary dictionary];
    if (![json isKindOfClass:[NSMutableDictionary class]]) json = [NSMutableDictionary dictionary];

    NSString *shim = [[self supportPath:@"bin"] stringByAppendingPathComponent:@"klick-hook"];
    NSString *command = [NSString stringWithFormat:@"%@ claude done", shim];

    if (connect) {
        NSMutableDictionary *hooks = [json[@"hooks"] mutableCopy] ?: [NSMutableDictionary dictionary];
        hooks[@"Stop"] = @[ @{ @"hooks": @[ @{ @"type": @"command", @"command": command } ] } ];
        hooks[@"Notification"] = @[ @{ @"hooks": @[ @{ @"type": @"command", @"command":
            [NSString stringWithFormat:@"%@ claude needs-you", shim] } ] } ];
        json[@"hooks"] = hooks;
    } else {
        NSMutableDictionary *hooks = [json[@"hooks"] mutableCopy];
        [hooks removeObjectForKey:@"Stop"];
        [hooks removeObjectForKey:@"Notification"];
        if (hooks.count) json[@"hooks"] = hooks; else [json removeObjectForKey:@"hooks"];
    }

    NSData *out = [NSJSONSerialization dataWithJSONObject:json options:NSJSONWritingPrettyPrinted error:nil];
    BOOL ok = [out writeToFile:path atomically:YES];
    [self log:@"claude hooks %@: %@", connect ? @"connected" : @"removed", ok ? @"ok" : @"failed"];
    return @{ @"ok": @(ok) };
}

- (void)pushSettingsToWeb {
    [self pushEvent:@"settings" payload:self.settings];
    if (self.buddyWeb) {
        NSData *json = [NSJSONSerialization dataWithJSONObject:self.settings
                                                       options:NSJSONWritingFragmentsAllowed error:nil];
        NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
        NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent('settings', %@)", text];
        [self.buddyWeb evaluateJavaScript:js completionHandler:nil];
    }
}
- (void)pushStatusToWeb {
    if (!self.webView) return;
    BOOL healthy = klick_capture_is_running();
    [self pushEvent:@"hookStatus" payload:@{ @"ok": @(healthy), @"platform": @"darwin",
                                             @"reason": healthy ? [NSNull null] : @"permission" }];
}

- (void)pushEvent:(NSString *)name payload:(id)payload {
    if (!self.webView) return;
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload ?: [NSNull null]
                                                   options:NSJSONWritingFragmentsAllowed error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent(%@, %@)",
                    [self jsonQuote:name], text ?: @"null"];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

@end

// `Klick --hook claude done` — used by the agent shim scripts.
static int run_hook(int argc, const char *argv[]) {
    NSMutableString *line = [NSMutableString string];
    for (int i = 2; i < argc; i++) {
        if (line.length) [line appendString:@" "];
        [line appendString:[NSString stringWithUTF8String:argv[i]]];
    }
    [line appendString:@"\n"];

    NSString *sock = [@"~/Library/Application Support/Klick/agents.sock" stringByExpandingTildeInPath];
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return 1;

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, sock.UTF8String, sizeof(addr.sun_path) - 1);

    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) { close(fd); return 1; }
    ssize_t written = write(fd, line.UTF8String, line.length);
    close(fd);
    return written > 0 ? 0 : 1;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc >= 3 && strcmp(argv[1], "--hook") == 0) return run_hook(argc, argv);

        // one Klick only: a second copy would steal the tap and confuse TCC
        NSString *lockPath = [@"~/Library/Application Support/Klick/klick.lock" stringByExpandingTildeInPath];
        [[NSFileManager defaultManager] createDirectoryAtPath:[lockPath stringByDeletingLastPathComponent]
                                  withIntermediateDirectories:YES attributes:nil error:nil];
        int lockFD = open(lockPath.UTF8String, O_CREAT | O_RDWR, 0644);
        if (lockFD < 0 || flock(lockFD, LOCK_EX | LOCK_NB) != 0) {
            // A stale lock file must not block launch: confirm a real second
            // instance before giving up.
            NSUInteger others = 0;
            for (NSRunningApplication *app in
                 [NSRunningApplication runningApplicationsWithBundleIdentifier:@"app.klick.Klick"]) {
                if (app.processIdentifier != getpid()) others++;
            }
            if (others > 0) {
                NSLog(@"another Klick is already running — exiting");
                return 0;
            }
            NSLog(@"stale lock file — continuing");
        }
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
