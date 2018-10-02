class EasyRtcHyrbidAdapter {
  constructor (easyrtc) {
    this.easyrtc = easyrtc || window.easyrtc
    this.app = 'default'
    this.room = 'default'

    // this.connectedClients = []

    this.audioStreams = {}
    this.pendingAudioRequest = {}

    this.serverTimeRequests = 0
    this.timeOffsets = []
    this.avgTimeOffset = 0
  }

  setServerUrl (url) {
    this.easyrtc.setSocketUrl(url)
  }

  setApp (appName) {
    this.app = appName
  }

  setRoom (roomName) {
    this.room = roomName
    this.easyrtc.joinRoom(roomName, null)
  }

  // options: { datachannel: bool, audio: bool }
  setWebRtcOptions (options) {
    this.easyrtc.enableVideo(false)
    this.easyrtc.enableAudio(options.audio)

    this.easyrtc.enableVideoReceive(false)
    this.easyrtc.enableAudioReceive(options.audio)
  }

  setServerConnectListeners (successListener, failureListener) {
    this.connectSuccess = successListener
    this.connectFailure = failureListener
  }

  setRoomOccupantListener (occupantListener) {
    this.easyrtc.setRoomOccupantListener(function (
      roomName,
      occupants,
      primary
    ) {
      occupantListener(occupants)
    })
  }

  setDataChannelListeners (openListener, closedListener, messageListener) {
    // PeerOpenListener never gets called
    // this.easyrtc.setPeerOpenListener(openListener)
    this.openListener = openListener
    this.easyrtc.setPeerClosedListener(closedListener)
    this.easyrtc.setPeerListener(messageListener)
  }

  updateTimeOffset () {
    const clientSentTime = Date.now() + this.avgTimeOffset

    return window.fetch(document.location.href, { method: 'HEAD', cache: 'no-cache' })
      .then(res => {
        var precision = 1000
        var serverReceivedTime = new Date(res.headers.get('Date')).getTime() + (precision / 2)
        var clientReceivedTime = Date.now()
        var serverTime = serverReceivedTime + ((clientReceivedTime - clientSentTime) / 2)
        var timeOffset = serverTime - clientReceivedTime

        this.serverTimeRequests++

        if (this.serverTimeRequests <= 10) {
          this.timeOffsets.push(timeOffset)
        } else {
          this.timeOffsets[this.serverTimeRequests % 10] = timeOffset
        }

        this.avgTimeOffset = this.timeOffsets.reduce((acc, offset) => { acc += offset; return acc }, 0) / this.timeOffsets.length

        if (this.serverTimeRequests > 10) {
          setTimeout(() => this.updateTimeOffset(), 5 * 60 * 1000) // Sync clock every 5 minutes.
        } else {
          this.updateTimeOffset()
        }
      })
  }

  connect () {
    Promise.all([
      this.updateTimeOffset(),
      new Promise((resolve, reject) => {
        if (this.easyrtc.audioEnabled) {
          this._connectWithAudio(resolve, reject)
        } else {
          this.easyrtc.connect(this.app, resolve, reject)
        }
      })
    ]).then(([_, clientId]) => {
      this._storeAudioStream(
        this.easyrtc.myEasyrtcid,
        this.easyrtc.getLocalStream()
      )
      // ??? join time differs from ws
      this._myRoomJoinTime = this._getRoomJoinTime(clientId)
      this.connectSuccess(clientId)
    }).catch(this.connectFailure)
  }

  shouldStartConnectionTo (client) {
    // ???? always true in ws adapter
    return this._myRoomJoinTime <= client.roomJoinTime
    // return true
  }

  startStreamConnection (clientId) {
    // added from ws adapter
    this.openListener(clientId)
    /// end added
    this.easyrtc.call(
      clientId,
      function (caller, media) {
        if (media === 'datachannel') {
          window.NAF.log.write('Successfully started datachannel to ', caller)
        }
      },
      function (errorCode, errorText) {
        window.NAF.log.error(errorCode, errorText)
      },
      function (wasAccepted) {
        // console.log("was accepted=" + wasAccepted);
      }
    )
  }

  closeStreamConnection (clientId) {
    // handled by easyRTC
  }

  sendData (clientId, dataType, data) {
    // always websockets
    this.sendDataGuaranteed(clientId, dataType, data)
  }

  sendDataGuaranteed (clientId, dataType, data) {
    this.easyrtc.sendDataWS(clientId, dataType, data)
  }

  broadcastData (dataType, data) {
    // always websockets
    this.broadcastDataGuaranteed(dataType, data)
  }

  broadcastDataGuaranteed (dataType, data) {
    var destination = { targetRoom: this.room }
    this.easyrtc.sendDataWS(destination, dataType, data)
  }

  getConnectStatus (clientId) {
    var status = this.easyrtc.getConnectStatus(clientId)

    if (status === this.easyrtc.IS_CONNECTED) {
      return window.NAF.adapters.IS_CONNECTED
    } else if (status === this.easyrtc.NOT_CONNECTED) {
      return window.NAF.adapters.NOT_CONNECTED
    } else {
      return window.NAF.adapters.CONNECTING
    }
  }

  getMediaStream (clientId) {
    var that = this
    if (this.audioStreams[clientId]) {
      window.NAF.log.write('Already had audio for ' + clientId)
      return Promise.resolve(this.audioStreams[clientId])
    } else {
      window.NAF.log.write('Waiting on audio for ' + clientId)
      return new Promise(function (resolve) {
        that.pendingAudioRequest[clientId] = resolve
      })
    }
  }

  disconnect () {
    this.easyrtc.disconnect()
  }

  /**
   * Privates
   */

  _storeAudioStream (easyrtcid, stream) {
    this.audioStreams[easyrtcid] = stream
    if (this.pendingAudioRequest[easyrtcid]) {
      window.NAF.log.write('got pending audio for ' + easyrtcid)
      this.pendingAudioRequest[easyrtcid](stream)
      delete this.pendingAudioRequest[easyrtcid](stream)
    }
  }

  _connectWithAudio (connectSuccess, connectFailure) {
    var that = this

    this.easyrtc.setStreamAcceptor(this._storeAudioStream.bind(this))

    this.easyrtc.setOnStreamClosed(function (easyrtcid) {
      delete that.audioStreams[easyrtcid]
    })

    this.easyrtc.initMediaSource(
      function () {
        that.easyrtc.connect(that.app, connectSuccess, connectFailure)
      },
      function (errorCode, errmesg) {
        window.NAF.log.error(errorCode, errmesg)
      }
    )
  }

  _getRoomJoinTime (clientId) {
    var myRoomId = window.NAF.room
    var joinTime = this.easyrtc.getRoomOccupantsAsMap(myRoomId)[clientId]
      .roomJoinTime
    return joinTime
  }

  getServerTime () {
    return Date.now() + this.avgTimeOffset
  }
}

module.exports = EasyRtcHyrbidAdapter
