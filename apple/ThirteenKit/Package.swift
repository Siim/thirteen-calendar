// swift-tools-version: 6.0
//
// ThirteenKit — Swift port of @thirteen/core (packages/core), the engine for perennial
// 13 × 28 calendars (International Fixed Calendar, Positivist). Rules: docs/SPEC.md.
// Parity with the TypeScript engine is enforced by Tests/ThirteenKitTests against
// fixtures/conversions.json (read in place from the repository, never copied).

import PackageDescription

let package = Package(
    name: "ThirteenKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ThirteenKit", targets: ["ThirteenKit"]),
    ],
    targets: [
        .target(name: "ThirteenKit"),
        .testTarget(name: "ThirteenKitTests", dependencies: ["ThirteenKit"]),
    ],
    swiftLanguageModes: [.v6]
)
