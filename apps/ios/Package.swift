// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "LexidrawIOS",
  platforms: [.macOS(.v15), .iOS("26.0")],
  products: [
    .library(name: "EditorModelInterface", targets: ["EditorModelInterface"]),
    .library(name: "LexicalSwift", targets: ["LexicalSwift"]),
    .library(name: "LexicalReference", targets: ["LexicalReference"]),
    .library(name: "LexicalFuzz", targets: ["LexicalFuzz"]),
    .library(name: "TextKitEditor", targets: ["TextKitEditor"]),
    .library(name: "LexidrawKit", targets: ["LexidrawKit"]),
    .library(name: "DrawingKit", targets: ["DrawingKit"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-collections", from: "1.1.0"),
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0"),
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.13.1"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.3.1"),
  ],
  targets: [
    .systemLibrary(name: "CLibxml2", pkgConfig: "libxml-2.0"),
    .target(
      name: "LexidrawJSON",
      dependencies: [.product(name: "OrderedCollections", package: "swift-collections")]
    ),
    .target(name: "EditorModelInterface", dependencies: ["LexidrawJSON", "CSSValues"]),
    .target(name: "CSSValues"),
    .target(
      name: "LexicalSwift",
      dependencies: [
        "EditorModelInterface",
        "CLibxml2",
        .product(name: "HashTreeCollections", package: "swift-collections"),
        .product(name: "OrderedCollections", package: "swift-collections"),
      ]
    ),
    .target(name: "LexicalReference", dependencies: ["LexicalSwift"]),
    .target(name: "LexicalFuzz", dependencies: ["LexicalSwift"]),
    .testTarget(
      name: "LexicalSwiftTests",
      dependencies: ["LexicalSwift", "LexicalReference", "LexicalFuzz"],
      resources: [.copy("Fixtures")]
    ),
    .target(name: "TextKitEditor", dependencies: ["EditorModelInterface", "CSSValues"]),
    .testTarget(
      name: "TextKitEditorTests",
      dependencies: ["TextKitEditor", "LexicalSwift", "LexicalReference", "LexicalFuzz"],
      resources: [.copy("Fixtures")]
    ),
    .target(
      name: "LexidrawKit",
      dependencies: [
        "LexidrawJSON",
        .product(name: "HTTPTypes", package: "swift-http-types"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
      ],
      plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
    ),
    .testTarget(
      name: "LexidrawKitTests",
      dependencies: [
        "LexidrawKit",
        .product(name: "HTTPTypes", package: "swift-http-types"),
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
      ],
      resources: [.copy("Fixtures")]
    ),
    .target(
      name: "DrawingKit",
      dependencies: ["LexidrawJSON", "CSSValues"],
      resources: [.copy("Fonts")]
    ),
    .testTarget(
      name: "DrawingKitTests",
      dependencies: ["DrawingKit"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
