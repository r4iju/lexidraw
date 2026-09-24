# Kitchen sink · 表示の見本

English and 日本語 share a paragraph: **bold 太字**, *italic*, ~~deleted~~, ==highlight==, `inline code`, and [a link](https://lexical.dev). This sentence checks wrapping and a comfortable reading rhythm on phones, tablets and wide screens. 東京でおいしい料理を作りましょう。

A second paragraph shares the same block gap. Long prose remains a readable measure even when the page has room for wider media and tables. This paragraph is deliberately long enough to wrap onto several lines on a phone and to expose an overly wide reading column on desktop.

*京都の秋、日本語の強調は傾けずに表示します。*

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

- [x] Written · 完了
- [ ] Review · 確認

> A short quote with **emphasis**. 日本語の引用も読みやすく。

```typescript
const greeting = "こんにちは";
console.log(greeting);
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

## Rich blocks · 図とメディア

The following blocks come from kitchen-sink.blocks.json until they have Markdown forms.

<!-- TODO #91: add all five GitHub callouts and replace the JSON collapsible with details/summary Markdown. -->
