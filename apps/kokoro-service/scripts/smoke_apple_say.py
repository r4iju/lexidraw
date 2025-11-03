#!/usr/bin/env python3
"""Smoke test for apple_say provider.

Tests edge cases that previously caused failures:
- Text starting with '-' (bullet points)
- Long paragraphs
- Multilingual content
"""

import sys
from pathlib import Path

# Add parent directory to path to import provider
sys.path.insert(0, str(Path(__file__).parent.parent))

from providers.apple_say import AppleSayProvider


def test_bullet_points():
    """Test text starting with '-' which was causing CLI parsing errors."""
    print("Testing bullet points...")
    provider = AppleSayProvider()
    if not provider.is_available():
        print("SKIP: apple_say not available")
        return True

    text = """- **Performance:** TBD - Specific performance metrics need to be defined.
- **Scalability:** The system must be scalable to handle a large number of users and a growing volume of slide decks.
- **Security:** Robust security protocols are required to protect user data and the generated content. Specific security measures need to be defined."""

    try:
        audio, sr = provider.synthesize(
            text=text,
            voiceId="Alva",
            speed=1.0,
            languageCode="sv_SE",
        )
        print(f"✓ Success: Generated {len(audio)} samples at {sr}Hz")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def test_long_paragraph():
    """Test very long text chunk."""
    print("\nTesting long paragraph...")
    provider = AppleSayProvider()
    if not provider.is_available():
        print("SKIP: apple_say not available")
        return True

    # Generate a long paragraph
    text = " ".join(["This is a test sentence."] * 50)

    try:
        audio, sr = provider.synthesize(
            text=text,
            voiceId="Alex",
            speed=1.0,
            languageCode="en_US",
        )
        print(f"✓ Success: Generated {len(audio)} samples at {sr}Hz")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def test_multilingual():
    """Test multilingual content."""
    print("\nTesting multilingual content...")
    provider = AppleSayProvider()
    if not provider.is_available():
        print("SKIP: apple_say not available")
        return True

    # Mix of English and Swedish
    text = """Hello world! This is a test.
Hej världen! Detta är ett test.
Bonjour le monde! Ceci est un test."""

    try:
        audio, sr = provider.synthesize(
            text=text,
            voiceId="Alex",
            speed=1.0,
            languageCode="en_US",
        )
        print(f"✓ Success: Generated {len(audio)} samples at {sr}Hz")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def test_special_characters():
    """Test text with special characters."""
    print("\nTesting special characters...")
    provider = AppleSayProvider()
    if not provider.is_available():
        print("SKIP: apple_say not available")
        return True

    text = """Text with special chars: @#$%^&*()[]{}|\\:;"'<>?,./~`"""

    try:
        audio, sr = provider.synthesize(
            text=text,
            voiceId="Alex",
            speed=1.0,
            languageCode="en_US",
        )
        print(f"✓ Success: Generated {len(audio)} samples at {sr}Hz")
        return True
    except Exception as e:
        print(f"✗ Failed: {e}")
        return False


def main():
    """Run all smoke tests."""
    print("Running apple_say smoke tests...\n")

    results = []
    results.append(("Bullet points", test_bullet_points()))
    results.append(("Long paragraph", test_long_paragraph()))
    results.append(("Multilingual", test_multilingual()))
    results.append(("Special characters", test_special_characters()))

    print("\n" + "=" * 50)
    print("Summary:")
    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"  {status}: {name}")

    print(f"\n{passed}/{total} tests passed")

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
