---
title: Kitchen sink
subtitle: Every block the editor draws, in both scripts · すべてのブロック
cover: data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMTAwIiBoZWlnaHQ9IjkwMCI+PHJlY3Qgd2lkdGg9IjIxMDAiIGhlaWdodD0iOTAwIiBmaWxsPSIjZTBmMmZlIi8+PGNpcmNsZSBjeD0iMTA1MCIgY3k9IjQ1MCIgcj0iMzAwIiBmaWxsPSIjMGVhNWU5Ii8+PC9zdmc+
cover_alt: A pale blue cover
toc: true
properties:
  status: in review
  owner: "@ada"
  reviewed: 2026-09-01
  source: https://lexical.dev/docs/intro
  note: Checked with @ben on a phone
---

# Kitchen sink · 表示の見本

English and 日本語 share a paragraph: **bold 太字**, *italic*, ~~deleted~~, ==highlight==, `inline code`, and [a link](https://lexical.dev). This sentence checks wrapping and a comfortable reading rhythm on phones, tablets and wide screens. 東京でおいしい料理を作りましょう。

A second paragraph shares the same block gap. Long prose remains a readable measure even when the page has room for wider media and tables. This paragraph is deliberately long enough to wrap onto several lines on a phone and to expose an overly wide reading column on desktop.

*京都の秋、日本語の強調は傾けずに表示します。*

A footnote marker sits in the accent colour[^accent] and a second follows it[^second].

![A wide figure · 横長の図](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAwIiBoZWlnaHQ9IjUwMCI+PHJlY3Qgd2lkdGg9IjE2MDAiIGhlaWdodD0iNTAwIiBmaWxsPSIjZmVmM2M3Ii8+PGNpcmNsZSBjeD0iODAwIiBjeT0iMjUwIiByPSIxNjYiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4= "A wide figure with its caption below · 図の説明"){.wide}

![Half the column · 半分](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2RjZmNlNyIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwMCIgcj0iMTMzIiBmaWxsPSIjMTZhMzRhIi8+PC9zdmc+){width=50%}

## Heading two · 京都の秋をゆっくり歩くための見出し

### Heading three

#### Heading four

##### Heading five

###### Heading six

- First bullet · 材料
    - Nested **strong** item
        - Third level marker
- Another item

1. Prepare · 準備する
    1. Nested step
        1. Third level step
2. Cook · 焼く

- [x] Written · 完了 with a long completed task that wraps onto a second line on a phone
- [ ] Review · 確認 with a long unfinished task that wraps onto a second line on a phone

> A short quote with **emphasis**. 日本語の引用も読みやすく。

> A separate quote after a blank line.

A long link: [https://example.com/documents/a-very-long-unbroken-path-that-must-wrap-on-a-phone-without-overflow](https://example.com/documents/a-very-long-unbroken-path-that-must-wrap-on-a-phone-without-overflow) and `a_very_long_inline_identifier_that_must_wrap_cleanly_on_a_phone`.

```typescript
// A readable comment in both themes
const greeting = "こんにちは";
console.log(greeting);
```

```js showLineNumbers
const longLine = "This deliberately long source line must scroll on a phone and wrap on paper while its number stays beside the first visual line.";
console.log(longLine);
```

```text
one line, no numbers
```

| Dish · 料理 | Time | Price |
| :--- | ---: | ---: |
| 鶏の唐揚げ | 20 min | ¥800 |
| Vegetable soup | 15 min | $5 |

| Key | Value |
| --- | --- |
| Owner | claude-dev |
| Updated | 2026-09-24 |

| Dish · 料理 | Method · 調理法 | Preparation | Cook time | Price | Rating |
| --- | --- | :---: | --- | --- | --- |
| 鶏の唐揚げ · Crispy chicken | Air fry until golden | Marinate overnight | 20 | ¥800 | 95% |
| Vegetable soup · 野菜スープ | Simmer gently with stock | Chop seasonal vegetables | 15 | $5 | 80% |
| Salmon · 鮭 | Roast with lemon and herbs | Pat dry before cooking | 12 | $12.50 | 90% |
| Tofu · 豆腐 | Sear both sides in a pan | Drain and press thoroughly | 8 | ¥400 | 85% |
| Rice · ご飯 | Steam with measured water | Rinse until water runs clear | Pending | ¥200 | 100% |

Inline math $E=mc^2$ and a block:

$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$

---

## Callouts and sections · 注記と折りたたみ

> [!NOTE]
> Useful information · 参考情報, even when skimming.

> [!TIP] Faster export
> Render at **375px** first; the phone view shows problems soonest.

> [!IMPORTANT]
> Key information users need to succeed · 重要.

> [!WARNING]
> Urgent info that needs immediate attention.
>
> - A second block inside the callout.

> [!CAUTION]
> Advises about risks or negative outcomes · 注意.

<details open>
<summary>Details · 詳細</summary>

Expanded content · 開いた内容

</details>

<columns>
<column>

Left column · 左

</column>
<column>

Right column · 右

</column>
<column>

Third column · 三

</column>
</columns>

## Rich blocks · 図とメディア

The following blocks come from kitchen-sink.blocks.json until they have Markdown forms.

![Tall hero · 2000px](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAwIiBoZWlnaHQ9IjIwMDAiPjxyZWN0IHdpZHRoPSIxMDAwIiBoZWlnaHQ9IjIwMDAiIGZpbGw9IiNmMWY1ZjkiLz48Y2lyY2xlIGN4PSI1MDAiIGN5PSIxMDAwIiByPSIzMDAiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=)

![Missing landscape · 画像なし](http://localhost:3025/visual-missing-image.png)

Latin *italic title* and **bold *italic title*** stay distinct in Japanese documents.

[^accent]: The note, with a way back to its marker · 脚注の本文。
[^second]: A second note keeps its number in print.
