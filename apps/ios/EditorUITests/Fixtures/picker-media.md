The Photos picker gates need both a real image and a real video in the simulator's
Photos library. `scripts/test-ui.sh` imports these fixtures before running them.
Both fixtures are disposable blue squares, generated with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=64x64 -frames:v 1 picker-image.png
ffmpeg -f lavfi -i color=c=blue:s=64x64:d=1 -c:v libx264 -pix_fmt yuv420p -movflags +faststart picker-video.mp4
```

The tests select through the system picker and assert the upload service's returned
URL in the saved editor document. The fixtures do not bypass Photos or upload.
