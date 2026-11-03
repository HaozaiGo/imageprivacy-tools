# Synthetic HEIC fixture

`synthetic.heic` is an original test fixture generated from geometric shapes on
a 1440 x 960 white canvas: a red 480 x 400 rectangle at (480, 280), blue 200 x 200
rectangle at (100, 100), and green 200 x 200 rectangle at (1140, 660). Colors are
`#e52234`, `#1748db`, and `#18a56c` respectively. No user image data is included.

The canvas PNG was encoded using macOS:

```bash
sips -s format heic imageprivacy-synthetic-source.png --out synthetic.heic
sips -g pixelWidth -g pixelHeight -g format synthetic.heic
```

- Dimensions: 1440 x 960
- Size: 2260 bytes
- SHA-256: `d23ca353b9d719a28fc824a784bff605ebd47ee818d2680366375fa7133c044e`

The checked-in bytes make CI independent of image-host availability or local
HEIC encoders. The smoke runner also supports the previously documented upstream
fixture via `HEIC_FIXTURE`, validating it against its separately pinned hash.
