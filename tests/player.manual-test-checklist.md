# Player Manual Test Checklist

Reference: Spec Phase 4, Section 8

Run these tests before considering the player complete. Check each box only after manually verifying.

---

## Setup
- [ ] Have a test video uploaded and available at a `/watch/[id]` URL
- [ ] Have Chrome DevTools open (F12 → Network tab)
- [ ] Have a real mobile device available (or BrowserStack)

---

## ABR / Quality Switching Tests

### Slow 3G Start
- [ ] Chrome DevTools → Network → throttle to **Slow 3G** (download ~500kbps)
- [ ] Load `/watch/[id]`
- [ ] **PASS**: First frame renders within **8 seconds**
- [ ] Confirm starting quality is 240p or 360p (not 720p)
- Notes: _______________

### Auto Quality Upgrade
- [ ] Start playback on Slow 3G (from above)
- [ ] Switch throttle to **No throttling** mid-playback
- [ ] Wait ~15–20 seconds
- [ ] **PASS**: Quality auto-upgrades (check quality indicator in player, or `window.hls?.currentLevel` in console)
- [ ] **PASS**: Playback does NOT restart or stutter significantly during the upgrade
- Notes: _______________

---

## Manual Quality Lock

### Lock to 240p
- [ ] Click gear icon → select **240p** from quality selector
- [ ] **PASS**: Quality switches to 240p within 1-2 segments
- [ ] Switch network to No throttling
- [ ] Wait 30 seconds
- [ ] **PASS**: Quality stays at 240p (does NOT auto-upgrade back)
- [ ] Verify: `window.hls?.autoLevelEnabled` should be `false` in console
- Notes: _______________

### Return to Auto
- [ ] Click gear icon → select **Auto**
- [ ] **PASS**: Quality begins auto-switching again based on bandwidth
- [ ] Verify: `window.hls?.autoLevelEnabled` should be `true` in console
- Notes: _______________

---

## Data Saver Mode

- [ ] Click **Data Saver ON** toggle in the watch page
- [ ] Switch network to No throttling
- [ ] Wait for auto quality to stabilize
- [ ] **PASS**: Quality never exceeds 480p
- [ ] Verify: `window.hls?.autoLevelCapping` should be the index of 480p in console
- [ ] Disable Data Saver → quality can now reach 720p+ on fast connection
- Notes: _______________

---

## Network Loss / Recovery

### Airplane Mode Mid-Playback
- [ ] Start playback on a fast connection
- [ ] Disable WiFi/data (OS-level, not DevTools)
- [ ] Within ~10 seconds: **PASS**: Buffering spinner appears
- [ ] After ~10 more seconds: **PASS**: Error message appears ("Connection lost..."), NOT an infinite spinner
- [ ] Re-enable network → test if recovery works (optional)
- Notes: _______________

---

## Mobile Device Tests (MUST test on real device, not just DevTools emulation)

### Layout at 375px width
- [ ] On real phone (iPhone SE or similar) at 375px
- [ ] **PASS**: No horizontal scroll or layout overflow
- [ ] **PASS**: All controls visible and usable
- [ ] **PASS**: Touch targets feel comfortable (≥44px verified by sight)
- Notes: _______________

### Quality Selector Bottom Sheet
- [ ] Tap the gear icon on mobile
- [ ] **PASS**: Quality selector appears as a **bottom sheet** (slides up from bottom), NOT a dropdown
- [ ] Tap a quality option
- [ ] **PASS**: Bottom sheet closes, quality switches
- [ ] Tap backdrop outside the sheet
- [ ] **PASS**: Sheet closes without selecting
- Notes: _______________

### Progress Bar Touch Scrubbing
- [ ] Touch and drag the progress bar to seek
- [ ] **PASS**: Seeking works smoothly on touch
- [ ] **PASS**: Bar expands to 12px height during drag
- Notes: _______________

### Orientation Change
- [ ] Start playback in portrait
- [ ] Rotate to landscape
- [ ] **PASS**: Player resizes correctly to fill width
- [ ] **PASS**: Controls remain positioned correctly
- [ ] Rotate back to portrait
- [ ] **PASS**: Layout returns correctly
- Notes: _______________

---

## Desktop Tests (≥768px)

### Volume Slider
- [ ] Hover over the speaker icon
- [ ] **PASS**: Horizontal volume slider appears
- [ ] Drag the slider
- [ ] **PASS**: Volume changes in real time
- [ ] Move mouse away
- [ ] **PASS**: Slider hides
- Notes: _______________

### Fullscreen
- [ ] Click fullscreen button
- [ ] **PASS**: Enters fullscreen
- [ ] Controls remain visible
- [ ] Press Escape or click exit button
- [ ] **PASS**: Exits fullscreen cleanly
- Notes: _______________

---

## Summary

| Test | Status | Notes |
|------|--------|-------|
| Slow 3G first frame ≤8s | | |
| Auto quality upgrade | | |
| Manual quality lock stays locked | | |
| Auto mode restores auto-switch | | |
| Data Saver caps at 480p | | |
| Airplane mode shows error within 10s | | |
| No overflow at 375px (real device) | | |
| Bottom sheet quality selector | | |
| Progress bar touch scrubbing | | |
| Orientation change | | |
| Volume slider hover (desktop) | | |
| Fullscreen (desktop) | | |

**Tested by:** _______________  
**Date:** _______________  
**Device(s):** _______________  
**Browser(s):** _______________
