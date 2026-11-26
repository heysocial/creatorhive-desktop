// Used by scripts/smoke-test.sh to read the app's window the way a person
// would: from a screenshot, with macOS's text recognition (Vision). Nothing in
// the app is opened up for it (released apps refuse remote debugging).
//   swift scripts/smoke-window.swift window <pid>   the main window's id, or nothing
//   swift scripts/smoke-window.swift text <png>     the text in a screenshot, one line each
import AppKit
import CoreGraphics
import Vision

let args = CommandLine.arguments
guard args.count == 3 else { exit(2) }

switch args[1] {
case "window":
  // The largest normal window the process owns (layer 0), on screen or not.
  let pid = Int(args[2])!
  let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  let mine = all.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
  func area(_ w: [String: Any]) -> Double {
    let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
    return (b["Width"] ?? 0) * (b["Height"] ?? 0)
  }
  if let main = mine.max(by: { area($0) < area($1) }), area(main) > 200 * 200 {
    print(main[kCGWindowNumber as String]!)
  }
case "text":
  guard let image = NSImage(contentsOfFile: args[2]),
        let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  try VNImageRequestHandler(cgImage: cg).perform([request])
  for observation in request.results ?? [] {
    if let line = observation.topCandidates(1).first?.string { print(line) }
  }
default:
  exit(2)
}
