import Foundation

/// Mirror of the CLI's JSON contract (`Transcript.to_dict()` in jdf_stt/types.py).
public struct Transcript: Codable, Equatable, Sendable {
    public struct Segment: Codable, Equatable, Sendable {
        public var start: Double
        public var end: Double
        public var text: String
    }

    public var text: String
    public var language: String?
    public var engine: String
    public var model: String
    public var duration: Double?
    public var segments: [Segment]

    public init(text: String, language: String?, engine: String, model: String, duration: Double?, segments: [Segment]) {
        self.text = text
        self.language = language
        self.engine = engine
        self.model = model
        self.duration = duration
        self.segments = segments
    }

    /// What the CLI's "no speech" (exit 0, nothing printed) becomes.
    public static let empty = Transcript(text: "", language: nil, engine: "", model: "", duration: nil, segments: [])
}
