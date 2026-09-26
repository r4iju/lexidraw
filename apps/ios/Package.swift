// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "LexidrawIOS",
  platforms: [.macOS(.v15), .iOS("26.0")],
  products: [
    .library(name: "LexicalSwift", targets: ["LexicalSwift"])
  ],
  targets: [
    .target(name: "LexicalSwift"),
    .target(name: "LexicalReference", dependencies: ["LexicalSwift"]),
    .target(name: "LexicalFuzz", dependencies: ["LexicalSwift"]),
    .testTarget(
      name: "LexicalSwiftTests",
      dependencies: ["LexicalSwift", "LexicalReference", "LexicalFuzz"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
