#!/bin/sh
set -eu
udid=$1
case "$2" in
  english)
    primary='en_US@sw=QWERTY;hw=Automatic'
    secondary='ja_JP-Romaji@sw=QWERTY-Japanese;hw=Automatic'
    ;;
  japanese)
    primary='ja_JP-Romaji@sw=QWERTY-Japanese;hw=Automatic'
    secondary='en_US@sw=QWERTY;hw=Automatic'
    ;;
  *) echo 'Expected english or japanese keyboard' >&2; exit 1 ;;
esac

# UIKit remembers its input mode and minimization after hardware key events.
xcrun simctl spawn "$udid" defaults write NSGlobalDomain AppleKeyboards -array "$primary" "$secondary" 'emoji@sw=Emoji'
xcrun simctl spawn "$udid" defaults write NSGlobalDomain AppleKeyboardsExpanded -int 1
xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences KeyboardLastUsed "$primary"
xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences KeyboardsCurrentAndNext -array "$primary" "$primary" "$secondary"
xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences HardwareKeyboardLastSeen -bool false
xcrun simctl spawn "$udid" defaults write com.apple.keyboard.preferences AutomaticMinimizationEnabled -bool false
xcrun simctl shutdown "$udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null
