# NAF EasyRTC Hyrbid Adapter

An adapter for networked-aframe that provides WebRTC voice chat in A-Frame,
but does not utilize DataChannels,
so it supports additional browsers and platforms:

* Microsoft Edge on Windows Mixed Reality and Hololens
* Exokit on Magic Leap
* iPhone and iPad on iOS

## To Use

```js
require('aframe')
require('networked-aframe')
require('naf-easyrtc-hybrid-adapter')
```

```html
<a-scene networked-scene="adapter: easyrtc-hyrbid; audio: true">
```
