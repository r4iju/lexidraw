// Generated from web media constructors and insertion URL parsers.
import Foundation

public enum MediaInsertions {
  public static let nodes: [String: String] = [
    "image": #"{"altText":"","caption":{"editorState":{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}},"height":0,"maxWidth":500,"showCaption":false,"src":"","type":"image","version":1,"width":0}"#,
    "inline-image": #"{"altText":"","caption":{"editorState":{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}},"height":0,"position":"left","showCaption":false,"src":"","type":"inline-image","captionsEnabled":true,"version":1,"width":0}"#,
    "video": #"{"caption":{"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}},"height":0,"src":"","type":"video","version":1,"width":0,"showCaption":true,"captionsEnabled":false}"#,
    "youtube": #"{"format":"","type":"youtube","version":1,"videoID":"","width":0,"height":0}"#,
    "tweet": #"{"format":"","type":"tweet","version":1,"id":""}"#,
    "figma": #"{"format":"","type":"figma","version":1,"documentID":""}"#,
  ]
  public static let youtubePattern = #"^.*(youtu\.be\/|v\/|u\/[A-Za-z0-9_]\/|embed\/|watch\?v=|&v=)([^#&?]*).*"#
  public static let tweetPattern = #"^https:\/\/(twitter|x)\.com\/(#!\/)?([A-Za-z0-9_]+)\/status(es)*\/([0-9]+)"#
  public static let figmaPattern = #"https:\/\/([A-Za-z0-9_.-]+\.)?figma.com\/(file|proto)\/([0-9a-zA-Z]{22,128})(?:\/.*)?$"#
  public static let youtubeCapture = 2
  public static let tweetCapture = 5
  public static let figmaCapture = 3
  public static let inlinePositions: [(String, String)] = [("left", "Left"), ("right", "Right"), ("full", "Full Width")]
  public static let youtubeIDLength = 11
  public static let gifSource = "/images/cat-typing.gif"
  public static let gifAltText = "Cat typing on a laptop"
}
