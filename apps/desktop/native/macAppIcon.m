#import <AppKit/AppKit.h>
#include <stdbool.h>

bool applyNativeAppIcon(const char *bundlePath, const char *imagePath) {
    @autoreleasepool {
        NSString *path = [NSString stringWithUTF8String:bundlePath];
        NSImage *image = [[NSImage alloc] initWithContentsOfFile:[NSString stringWithUTF8String:imagePath]];
        if (!image || !path) return false;
        // Legacy ICNS artwork can acquire an extra system background on recent macOS.
        // Keep the supplied artwork as the explicit Finder and running Dock icon.
        BOOL saved = [[NSWorkspace sharedWorkspace] setIcon:image forFile:path options:0];
        dispatch_async(dispatch_get_main_queue(), ^{
            [NSApp setApplicationIconImage:image];
        });
        return saved;
    }
}
