import Carbon
import Foundation

struct GlobalShortcutDefinition: Codable, Equatable {
    let code: String
    let modifiers: [String]

    static let quickCaptureDefault = try! GlobalShortcutDefinition(
        code: "Space",
        modifiers: ["option"]
    )

    init(code: String, modifiers: [String]) throws {
        guard let keyCode = Self.keyCodes[code] else {
            throw GlobalShortcutError.unsupportedKey
        }
        _ = keyCode

        let allowed = Set(["control", "option", "shift", "command"])
        let normalised = Array(Set(modifiers)).sorted { left, right in
            Self.modifierOrder.firstIndex(of: left)! < Self.modifierOrder.firstIndex(of: right)!
        }
        guard normalised.allSatisfy(allowed.contains) else {
            throw GlobalShortcutError.unsupportedModifier
        }
        guard normalised.contains(where: { $0 != "shift" }) else {
            throw GlobalShortcutError.modifierRequired
        }

        self.code = code
        self.modifiers = normalised
    }

    var keyCode: UInt32 {
        Self.keyCodes[code]!
    }

    var carbonModifiers: UInt32 {
        modifiers.reduce(0) { result, modifier in
            result | UInt32(Self.carbonModifiers[modifier]!)
        }
    }

    var label: String {
        let modifierLabel = modifiers.map { Self.modifierLabels[$0]! }.joined()
        let keyLabel = code == "Space" ? "Space" : String(code.dropFirst(code.hasPrefix("Key") ? 3 : 5))
        return "\(modifierLabel) \(keyLabel)"
    }

    private static let modifierOrder = ["control", "option", "shift", "command"]
    private static let modifierLabels = [
        "control": "⌃",
        "option": "⌥",
        "shift": "⇧",
        "command": "⌘",
    ]
    private static let carbonModifiers = [
        "control": controlKey,
        "option": optionKey,
        "shift": shiftKey,
        "command": cmdKey,
    ]
    private static let keyCodes: [String: UInt32] = [
        "Space": UInt32(kVK_Space),
        "KeyA": UInt32(kVK_ANSI_A),
        "KeyB": UInt32(kVK_ANSI_B),
        "KeyC": UInt32(kVK_ANSI_C),
        "KeyD": UInt32(kVK_ANSI_D),
        "KeyE": UInt32(kVK_ANSI_E),
        "KeyF": UInt32(kVK_ANSI_F),
        "KeyG": UInt32(kVK_ANSI_G),
        "KeyH": UInt32(kVK_ANSI_H),
        "KeyI": UInt32(kVK_ANSI_I),
        "KeyJ": UInt32(kVK_ANSI_J),
        "KeyK": UInt32(kVK_ANSI_K),
        "KeyL": UInt32(kVK_ANSI_L),
        "KeyM": UInt32(kVK_ANSI_M),
        "KeyN": UInt32(kVK_ANSI_N),
        "KeyO": UInt32(kVK_ANSI_O),
        "KeyP": UInt32(kVK_ANSI_P),
        "KeyQ": UInt32(kVK_ANSI_Q),
        "KeyR": UInt32(kVK_ANSI_R),
        "KeyS": UInt32(kVK_ANSI_S),
        "KeyT": UInt32(kVK_ANSI_T),
        "KeyU": UInt32(kVK_ANSI_U),
        "KeyV": UInt32(kVK_ANSI_V),
        "KeyW": UInt32(kVK_ANSI_W),
        "KeyX": UInt32(kVK_ANSI_X),
        "KeyY": UInt32(kVK_ANSI_Y),
        "KeyZ": UInt32(kVK_ANSI_Z),
        "Digit0": UInt32(kVK_ANSI_0),
        "Digit1": UInt32(kVK_ANSI_1),
        "Digit2": UInt32(kVK_ANSI_2),
        "Digit3": UInt32(kVK_ANSI_3),
        "Digit4": UInt32(kVK_ANSI_4),
        "Digit5": UInt32(kVK_ANSI_5),
        "Digit6": UInt32(kVK_ANSI_6),
        "Digit7": UInt32(kVK_ANSI_7),
        "Digit8": UInt32(kVK_ANSI_8),
        "Digit9": UInt32(kVK_ANSI_9),
    ]
}

enum GlobalShortcutError: LocalizedError {
    case unsupportedKey
    case unsupportedModifier
    case modifierRequired
    case registrationFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .unsupportedKey:
            "Use Space, a letter, or a number."
        case .unsupportedModifier:
            "That modifier is not supported."
        case .modifierRequired:
            "Include Control, Option, or Command."
        case .registrationFailed:
            "That shortcut is already in use."
        }
    }
}

enum QuickCaptureShortcutPreset: String, CaseIterable {
    case optionSpace
    case controlSpace
    case optionCommandSpace
    case disabled

    var title: String {
        switch self {
        case .optionSpace: "⌥ Space"
        case .controlSpace: "⌃ Space"
        case .optionCommandSpace: "⌥⌘ Space"
        case .disabled: "Off"
        }
    }

    var definition: GlobalShortcutDefinition? {
        switch self {
        case .optionSpace:
            try? GlobalShortcutDefinition(code: "Space", modifiers: ["option"])
        case .controlSpace:
            try? GlobalShortcutDefinition(code: "Space", modifiers: ["control"])
        case .optionCommandSpace:
            try? GlobalShortcutDefinition(code: "Space", modifiers: ["option", "command"])
        case .disabled:
            nil
        }
    }
}

private let quickCaptureHotKeyID = EventHotKeyID(signature: 0x415A454E, id: 1) // AZEN

private func handleGlobalHotKey(
    _ nextHandler: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData else { return OSStatus(eventNotHandledErr) }
    let registry = Unmanaged<GlobalShortcutRegistry>.fromOpaque(userData).takeUnretainedValue()
    DispatchQueue.main.async(execute: registry.onPress)
    return noErr
}

final class GlobalShortcutRegistry {
    fileprivate let onPress: () -> Void
    private var eventHandler: EventHandlerRef?
    private var hotKey: EventHotKeyRef?
    private(set) var definition: GlobalShortcutDefinition?

    init(onPress: @escaping () -> Void) {
        self.onPress = onPress
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }

    func register(_ next: GlobalShortcutDefinition) throws {
        if definition == next { return }
        if eventHandler == nil {
            var eventType = EventTypeSpec(
                eventClass: OSType(kEventClassKeyboard),
                eventKind: UInt32(kEventHotKeyPressed)
            )
            let status = InstallEventHandler(
                GetApplicationEventTarget(),
                handleGlobalHotKey,
                1,
                &eventType,
                Unmanaged.passUnretained(self).toOpaque(),
                &eventHandler
            )
            guard status == noErr else { throw GlobalShortcutError.registrationFailed(status) }
        }

        var nextHotKey: EventHotKeyRef?
        let status = RegisterEventHotKey(
            next.keyCode,
            next.carbonModifiers,
            quickCaptureHotKeyID,
            GetApplicationEventTarget(),
            OptionBits(kEventHotKeyExclusive),
            &nextHotKey
        )
        guard status == noErr, let nextHotKey else {
            throw GlobalShortcutError.registrationFailed(status)
        }

        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nextHotKey
        definition = next
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
        definition = nil
    }
}
