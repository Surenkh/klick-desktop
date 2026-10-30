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

#include "audio.h"
#include "capture.h"

static const char *kBundleID = "app.klick.Klick";

// ---------------------------------------------------------------- key mapping

typedef struct { int role; float pan; } KeyMap;

static KeyMap map_keycode(uint16_t code) {
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

// ------------------------------------------------------------------- app

@interface AppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler, NSWindowDelegate>
@property (nonatomic, strong) NSStatusItem *statusItem;
@property (nonatomic, strong) NSWindow *settingsWindow;
@property (nonatomic, strong) WKWebView *webView;
@property (nonatomic, strong) NSMutableDictionary *settings;
@property (nonatomic, strong) NSMutableArray<NSString *> *packNames;
@property (nonatomic, strong) NSString *packsDir;
@property (nonatomic, strong) NSString *logPath;
@property (nonatomic, assign) int activePack;
@property (nonatomic, assign) BOOL captureOK;
@property (nonatomic, assign) BOOL recordingTap;
@end

static AppDelegate *gApp = nil;

typedef struct { atomic_uint taps; atomic_uint xp; } Counters;
static Counters app_counters;

// Mirrors of the few settings the tap thread needs: no ObjC on the hot path.
static atomic_bool g_enabled;
static atomic_int g_volume_milli;
static atomic_bool g_release;
static _Atomic uint64_t g_last_key_mach;

// Runs on the CGEventTap thread: classification, one lock-free push, counters.
static void on_key(uint16_t code, bool down, uint64_t host_time) {
    if (!atomic_load(&g_enabled)) return;

    float gain = (float)atomic_load(&g_volume_milli) / 1000.0f;
    if (gain <= 0.001f) return;

    KeyMap m = map_keycode(code);
    float rate = 0.985f + ((float)arc4random_uniform(1000) / 1000.0f) * 0.03f;

    if (down) {
        atomic_store(&g_last_key_mach, host_time);
        audio_trigger(m.role, m.pan, gain, rate, host_time);
        atomic_fetch_add(&app_counters.taps, 1);
        atomic_fetch_add(&app_counters.xp, 1);
    } else if (atomic_load(&g_release) && m.role != KLICK_ROLE_MODIFIER) {
        audio_trigger(KLICK_ROLE_RELEASE, m.pan, gain * 0.7f, rate, host_time);
    }
}

static void mirror_settings(NSDictionary *settings) {
    atomic_store(&g_enabled, [settings[@"enabled"] boolValue]);
    atomic_store(&g_volume_milli, (int)lround([settings[@"volume"] doubleValue] * 1000.0));
    atomic_store(&g_release, [settings[@"releaseSounds"] boolValue]);
}

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    gApp = self;

    self.packNames = [NSMutableArray array];
    self.logPath = [self supportPath:@"klick.log"];
    [self loadSettings];
    [self setupStatusItem];

    self.packsDir = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"assets/packs"];

    audio_init();
    [self reloadPacks];

    [self startCapture];

    [[NSWorkspace sharedWorkspace].notificationCenter addObserver:self
        selector:@selector(didWake:) name:NSWorkspaceDidWakeNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
        selector:@selector(screenUnlocked:) name:NSWorkspaceScreensDidWakeNotification object:nil];

    // device changes and periodic work on the main thread
    [NSTimer scheduledTimerWithTimeInterval:1.0 target:self selector:@selector(tick:) userInfo:nil repeats:YES];

    [self log:@"boot (native) version %@ rate=%.0f Hz packs=%d",
        [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"],
        audio_device_rate(), audio_pack_count()];

    BOOL forceSettings = [[[NSProcessInfo processInfo] arguments] containsObject:@"--settings"];
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
        @"releaseSounds": @YES,
        @"mouseClicks": @YES,
        @"launchAtLogin": @NO,
        @"onboarded": @NO,
        @"taps": @0,
        @"xp": @0
    } mutableCopy];
    if (stored) [defaults addEntriesFromDictionary:stored];
    self.settings = defaults;
    mirror_settings(self.settings);
    atomic_store(&app_counters.taps, [self.settings[@"taps"] unsignedIntValue]);
    atomic_store(&app_counters.xp, [self.settings[@"xp"] unsignedIntValue]);
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
        item.state = fabs([self.settings[@"volume"] doubleValue] - level.doubleValue) < 0.01 ? NSControlStateValueOn : NSControlStateValueOff;
        [volumeMenu addItem:item];
    }
    volumeItem.submenu = volumeMenu;
    [menu addItem:volumeItem];

    NSMenuItem *packItem = [[NSMenuItem alloc] initWithTitle:@"Sound" action:nil keyEquivalent:@""];
    NSMenu *packMenu = [[NSMenu alloc] init];
    [self.packNames enumerateObjectsUsingBlock:^(NSString *name, NSUInteger index, BOOL *stop) {
        NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:name.capitalizedString
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

    NSMenuItem *settingsItem = [[NSMenuItem alloc] initWithTitle:@"Settings…" action:@selector(openSettings:) keyEquivalent:@","];
    [menu addItem:settingsItem];

    [menu addItem:[NSMenuItem separatorItem]];

    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Klick" action:@selector(quit:) keyEquivalent:@"q"];
    [menu addItem:quit];

    self.statusItem.menu = menu;
}

- (void)toggleSounds:(NSMenuItem *)item {
    self.settings[@"enabled"] = @(![self.settings[@"enabled"] boolValue]);
    [self rebuildMenu];
    [self saveSettings];
    [self pushSettingsToWeb];
}

- (void)setVolume:(NSMenuItem *)item {
    self.settings[@"volume"] = item.representedObject;
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
    NSString *bridge = [NSString stringWithContentsOfFile:[[NSBundle mainBundle].resourcePath
        stringByAppendingPathComponent:@"web/bridge.js"] encoding:NSUTF8StringEncoding error:nil];
    WKUserScript *script = [[WKUserScript alloc] initWithSource:bridge
        injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES];
    [config.userContentController addUserScript:script];
    [config.userContentController addScriptMessageHandler:self name:@"klick"];

    WKWebView *web = [[WKWebView alloc] initWithFrame:window.contentView.bounds configuration:config];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    window.contentView = web;

    NSString *html = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web/settings.html"];
    NSURL *url = [NSURL fileURLWithPath:html];
    if (![self.settings[@"onboarded"] boolValue]) {
        url = [NSURL URLWithString:[NSString stringWithFormat:@"%@?onboarding=1", url.absoluteString]];
    }
    NSString *webRoot = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web"];
    [web loadFileURL:url allowingReadAccessToURL:[NSURL fileURLWithPath:webRoot]];

    self.settingsWindow = window;
    self.webView = web;
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
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
    NSData *json = [NSJSONSerialization dataWithJSONObject:(result ?: [NSNull null]) options:0 error:nil];
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
        return @{ @"version": [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"0.4.0",
                  @"electron": @"—", @"chrome": @"—", @"node": @"—",
                  @"platform": @"darwin", @"arch": @"arm64" };
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
        return @{ @"ok": @(self.captureOK), @"reason": self.captureOK ? [NSNull null] : @"permission",
                  @"lastKeyAt": last ? @(nowMs - ageMs) : [NSNull null],
                  @"keysToday": @(atomic_load(&app_counters.taps)),
                  @"packs": @(self.packNames.count) };
    }
    if ([method isEqualToString:@"hookStatus"]) {
        return @{ @"ok": @(self.captureOK), @"platform": @"darwin",
                  @"reason": self.captureOK ? [NSNull null] : @"permission" };
    }
    if ([method isEqualToString:@"latency"]) {
        double deviceMs = (64.0 / (audio_device_rate() > 0 ? audio_device_rate() : 48000.0)) * 1000.0;
        return @{ @"baseMs": @(deviceMs), @"outputMs": @0,
                  @"handlingMs": @(audio_latency_ms()), @"state": @"running" };
    }
    if ([method isEqualToString:@"packs"]) return self.packNames;
    if ([method isEqualToString:@"stats"]) {
        return @{ @"taps": @(atomic_load(&app_counters.taps)), @"xp": @(atomic_load(&app_counters.xp)),
                  @"slaps": @0, @"level": @1, @"hat": [NSNull null], @"day": @"" };
    }
    if ([method isEqualToString:@"agents"]) return @{};
    if ([method isEqualToString:@"cueSamples"]) return @{ @"done": [NSNull null], @"error": [NSNull null] };
    if ([method isEqualToString:@"onboarded"]) { self.settings[@"onboarded"] = @YES; [self saveSettings]; return @YES; }
    if ([method isEqualToString:@"demoTap"]) {
        [self log:@"demo tap"];
        audio_trigger(KLICK_ROLE_KEYS, 0, [self.settings[@"volume"] floatValue], 1.0f, mach_absolute_time());
        atomic_fetch_add(&app_counters.taps, 1);
        return @YES;
    }
    if ([method isEqualToString:@"setSettings"]) {
        NSDictionary *patch = args[@"patch"];
        if ([patch isKindOfClass:[NSDictionary class]]) {
            [self.settings addEntriesFromDictionary:patch];
            if (patch[@"pack"]) {
                NSUInteger index = [self.packNames indexOfObject:patch[@"pack"]];
                if (index != NSNotFound) { self.activePack = (int)index; audio_select_pack(self.activePack); }
            }
            [self saveSettings];
            [self rebuildMenu];
        }
        return self.settings;
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

- (void)pushSettingsToWeb { [self pushEvent:@"settings" payload:self.settings]; }
- (void)pushStatusToWeb {
    if (!self.webView) return;
    [self pushEvent:@"hookStatus" payload:@{ @"ok": @(self.captureOK), @"platform": @"darwin",
                                             @"reason": self.captureOK ? [NSNull null] : @"permission" }];
}

- (void)pushEvent:(NSString *)name payload:(id)payload {
    if (!self.webView) return;
    NSData *json = [NSJSONSerialization dataWithJSONObject:payload ?: [NSNull null] options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__klickEvent && window.__klickEvent(%@, %@)",
                    [self jsonQuote:name], text ?: @"null"];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
