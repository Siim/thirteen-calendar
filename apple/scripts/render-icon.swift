// Renders AppIcon.appiconset from the "Page 13" SVG masters in design/icon/ (see its README.md).
//
//   swift render-icon.swift <design/icon> <AppIcon.appiconset>
//
// One shared source for iOS and macOS: icon-1024.png is the full-bleed 1024 px artwork, used by the
// iOS/iPadOS "any" appearance and by the macOS 512 pt @2x slot (actool derives the smaller Mac
// sizes from it). Both systems apply their own mask: iOS its rounded square, macOS 27 the same
// squircle. icon-1024-dark.png and icon-1024-tinted.png are the iOS dark and tinted appearances
// (asset catalogs have no Mac appearances; design/icon/exports/apple/AppIcon.icon has them).
// All three are opaque sRGB. NSImage renders SVG natively (macOS 14 and later).
import AppKit
import CoreGraphics

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write(
        Data("usage: render-icon.swift <design/icon> <AppIcon.appiconset>\n".utf8))
    exit(1)
}
let design = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let side = 1024

for (source, name) in [
    ("thirteen-icon.svg", "icon-1024.png"),
    ("thirteen-icon-dark.svg", "icon-1024-dark.png"),
    ("thirteen-icon-tinted.svg", "icon-1024-tinted.png"),
] {
    guard let image = NSImage(contentsOf: design.appendingPathComponent(source)) else {
        FileHandle.standardError.write(Data("render-icon: cannot load \(source)\n".utf8))
        exit(1)
    }
    let cg = CGContext(
        data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: false)
    image.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
    NSGraphicsContext.restoreGraphicsState()
    let rep = NSBitmapImageRep(cgImage: cg.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!
        .write(to: out.appendingPathComponent(name))
}
