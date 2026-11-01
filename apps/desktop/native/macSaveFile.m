#import <AppKit/AppKit.h>

@interface saveFileState : NSObject
@property(nonatomic, strong) NSSavePanel *panel;
@property(nonatomic, copy) NSString *path;
@end
@implementation saveFileState
@end

static void onMain(void (^action)(void)) {
    if ([NSThread isMainThread]) action();
    else dispatch_sync(dispatch_get_main_queue(), action);
}

void *beginNativeSaveFile(const char *fileName) {
    __block void *handle = NULL;
    onMain(^{ @autoreleasepool {
        saveFileState *state = [saveFileState new];
        state.panel = [NSSavePanel savePanel];
        state.panel.title = @"保存视频与素材";
        state.panel.nameFieldStringValue = [NSString stringWithUTF8String:fileName];
        state.panel.canCreateDirectories = YES;
        state.panel.directoryURL = [NSURL fileURLWithPath:NSHomeDirectory()];
        NSWindow *parent = NSApp.keyWindow;
        void (^complete)(NSModalResponse) = ^(NSModalResponse response) {
            state.path = response == NSModalResponseOK ? state.panel.URL.path : @"";
        };
        handle = (__bridge_retained void *)state;
        [NSApp activateIgnoringOtherApps:YES];
        if (parent) [state.panel beginSheetModalForWindow:parent completionHandler:complete];
        else [state.panel beginWithCompletionHandler:complete];
    }});
    return handle;
}

const char *readNativeSaveFile(void *handle) {
    if (!handle) return NULL;
    __block const char *result = NULL;
    onMain(^{
        saveFileState *state = (__bridge saveFileState *)handle;
        result = state.path.UTF8String;
    });
    return result;
}

void closeNativeSaveFile(void *handle) {
    if (!handle) return;
    onMain(^{
        saveFileState *state = (__bridge_transfer saveFileState *)handle;
        if (!state.path) [state.panel cancel:nil];
        state.panel = nil;
    });
}
