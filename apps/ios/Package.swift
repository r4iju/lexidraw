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
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-collections", from: "1.1.0"),
    .package(url: "https://github.com/apple/swift-http-types", from: "1.8.0"),
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.13.1"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.3.1"),
  ],
  targets: [
    .target(
      name: "EditorModelInterface",
      dependencies: [.product(name: "OrderedCollections", package: "swift-collections")]
    ),
    .target(
      name: "LexicalSwift",
      dependencies: [
        "EditorModelInterface",
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
    .target(name: "TextKitEditor", dependencies: ["EditorModelInterface"]),
    .testTarget(
      name: "TextKitEditorTests",
      dependencies: ["TextKitEditor", "LexicalSwift", "LexicalReference", "LexicalFuzz"]
    ),
    .target(
      name: "LexidrawKit",
      dependencies: [
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
  ]
)
