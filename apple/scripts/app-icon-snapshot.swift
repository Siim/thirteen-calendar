// Renders the icon macOS shows for an app bundle (what Finder and the Dock draw) to a PNG, so the
// compiled AppIcon can be checked after a build:
//
//   swift apple/scripts/app-icon-snapshot.swift <path/to/Thirteen.app> <out.png> [size]
//
// Size defaults to 512 (pixels). The result includes whatever the system adds: the squircle mask,
// the glass rim, or the grey squircle frame macOS 26 puts around icons that are not the right
// shape. The bundle is registered with Launch Services first (otherwise a fresh build directory
// can come back as a generic document icon). Icon Services caches icons by path, so to compare two
// builds copy each one to its own path first (ditto Thirteen.app /tmp/Thirteen-1.app).
import AppKit
import CoreServices

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(Data("usage: app-icon-snapshot.swift <app> <out.png> [size]\n".utf8))
    exit(1)
}
let app = URL(fileURLWithPath: args[1])
let side = args.count > 3 ? Int(args[3]) ?? 512 : 512
LSRegisterURL(app as CFURL, true)

let icon = NSWorkspace.shared.icon(forFile: app.path)
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8,
    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: side, height: side)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
