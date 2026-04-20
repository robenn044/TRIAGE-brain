import { SerialPort } from 'serialport'
import { readdirSync } from 'node:fs'

const DEFAULT_BAUD_RATE = Number(process.env.TRIAGE_ROBOT_BAUD_RATE || 9600)
const DEFAULT_PORT = process.env.TRIAGE_ROBOT_SERIAL_PORT || ''
const HEARTBEAT_MS = Number(process.env.TRIAGE_ROBOT_HEARTBEAT_MS || 500)
const COMMAND_BURST_MS = Number(process.env.TRIAGE_ROBOT_COMMAND_BURST_MS || 375)
const CONNECT_SETTLE_MS = Number(process.env.TRIAGE_ROBOT_CONNECT_SETTLE_MS || 1200)
const MODE_SWITCH_SETTLE_MS = Number(process.env.TRIAGE_ROBOT_MODE_SWITCH_SETTLE_MS || 220)
const DIRECTION_SETTLE_MS = Number(process.env.TRIAGE_ROBOT_DIRECTION_SETTLE_MS || 160)
const COMMAND_GUARD_MS = Number(process.env.TRIAGE_ROBOT_COMMAND_GUARD_MS || 100)

function nowIso() {
  return new Date().toISOString()
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeMode(mode) {
  const value = String(mode || '').trim().toUpperCase()
  if (value === 'LINE') return 'line'
  if (value === 'AI') return 'ai'
  return 'unknown'
}

function normalizeCommand(command) {
  const value = String(command || '').trim().toUpperCase()
  const aliases = {
    FORWARD: 'FWD',
    FWD: 'FWD',
    BACK: 'BACK',
    REVERSE: 'BACK',
    LEFT: 'LEFT',
    RIGHT: 'RIGHT',
    STOP: 'STOP',
  }

  return aliases[value] || 'STOP'
}

function isMovingCommand(command) {
  return normalizeCommand(command) !== 'STOP'
}

function isRetryableSerialError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /(cannot open|no such file|enoent|port is not open|disconnected|input\/output error|resource busy|ebusy|eio)/i.test(
    message,
  )
}

function looksLikeArduino(portInfo) {
  const haystack = [
    portInfo.path,
    portInfo.manufacturer,
    portInfo.friendlyName,
    portInfo.vendorId,
    portInfo.productId,
    portInfo.serialNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return ['arduino', 'usb serial', 'wch', 'ch340', 'ttyacm', 'ttyusb', 'cp210', 'usbmodem'].some(token =>
    haystack.includes(token),
  )
}

function scanLinuxSerialPaths() {
  try {
    return readdirSync('/dev')
      .filter(name => /^tty(USB|ACM|AMA)\d+$/.test(name))
      .map(name => `/dev/${name}`)
  } catch {
    return []
  }
}

function getPortPriority(path, isRecommended) {
  const value = String(path || '').toLowerCase()
  if (isRecommended) return 100
  if (value.includes('/dev/ttyusb')) return 90
  if (value.includes('/dev/ttyacm')) return 85
  if (value.includes('usbmodem')) return 80
  if (value.includes('/dev/ttyama')) return 10
  return 50
}

export class RobotController {
  constructor() {
    this.port = null
    this.buffer = ''
    this.connected = false
    this.mode = 'unknown'
    this.drive = 'STOP'
    this.lastError = null
    this.lastMessage = null
    this.lastTelemetryAt = null
    this.lastCommandAt = null
    this.portPath = DEFAULT_PORT || null
    this.manualStopTimer = null
    this.heartbeatTimer = null
    this.baudRate = DEFAULT_BAUD_RATE
    this.lastDriveIssuedAt = 0
  }

  async listPorts() {
    const ports = await SerialPort.list()
    const mappedPorts = ports.map(port => ({
      path: port.path,
      manufacturer: port.manufacturer || null,
      friendlyName: port.friendlyName || null,
      isRecommended: looksLikeArduino(port),
    }))

    const knownPaths = new Set(mappedPorts.map(port => port.path))
    for (const path of scanLinuxSerialPaths()) {
      if (knownPaths.has(path)) {
        continue
      }

      mappedPorts.push({
        path,
        manufacturer: null,
        friendlyName: null,
        isRecommended: /\/dev\/tty(USB|ACM)\d+$/i.test(path),
      })
    }

    return mappedPorts.sort((left, right) => {
      return getPortPriority(right.path, right.isRecommended) - getPortPriority(left.path, left.isRecommended)
    })
  }

  async getPreferredPortPath(requestedPath = null) {
    const ports = await this.listPorts()
    if (!ports.length) {
      return null
    }

    const availablePaths = new Set(ports.map(port => port.path))
    const candidates = [requestedPath, this.portPath, DEFAULT_PORT].filter(Boolean)
    for (const candidate of candidates) {
      if (availablePaths.has(candidate)) {
        return candidate
      }
    }

    const preferred = ports.find(port => port.isRecommended) || ports[0]
    return preferred?.path || null
  }

  async connect(requestedPath) {
    const normalizedRequestedPath = typeof requestedPath === 'string' && requestedPath.trim() ? requestedPath.trim() : null

    if (
      this.connected &&
      this.port &&
      this.port.isOpen &&
      (!normalizedRequestedPath || normalizedRequestedPath === this.portPath)
    ) {
      return this.getStatus()
    }

    const portPath = await this.getPreferredPortPath(normalizedRequestedPath)
    if (!portPath) {
      this.lastError = 'No Arduino serial port detected'
      throw new Error(this.lastError)
    }

    this.portPath = portPath
    await this.disconnect({ preserveMode: true })

    await new Promise((resolve, reject) => {
      const port = new SerialPort(
        {
          path: portPath,
          baudRate: this.baudRate,
          autoOpen: false,
        },
        undefined,
      )

      port.open(error => {
        if (error) {
          reject(error)
          return
        }

        this.port = port
        this.connected = true
        this.portPath = portPath
        this.lastError = null
        this.lastMessage = `Connected to ${portPath}`
        this.lastTelemetryAt = nowIso()
        this.attachPortListeners(port)
        resolve()
      })
    })

    await delay(CONNECT_SETTLE_MS)
    await this.requestStatus()
    return this.getStatus()
  }

  attachPortListeners(port) {
    port.on('data', chunk => {
      this.buffer += chunk.toString('utf8')

      while (this.buffer.includes('\n')) {
        const newlineIndex = this.buffer.indexOf('\n')
        const line = this.buffer.slice(0, newlineIndex).trim()
        this.buffer = this.buffer.slice(newlineIndex + 1)
        if (!line) {
          continue
        }

        this.handleLine(line)
      }
    })

    port.on('error', error => {
      this.lastError = error.message
      this.connected = false
      this.port = null
      this.buffer = ''
      this.stopHeartbeat()
    })

    port.on('close', () => {
      this.connected = false
      this.port = null
      this.buffer = ''
      this.drive = 'STOP'
      this.stopHeartbeat()
    })
  }

  handleLine(line) {
    this.lastMessage = line
    this.lastTelemetryAt = nowIso()

    if (line.startsWith('READY MODE=')) {
      this.mode = normalizeMode(line.slice('READY MODE='.length))
      this.drive = 'STOP'
      this.stopHeartbeat()
      return
    }

    if (line.startsWith('OK MODE')) {
      this.mode = normalizeMode(line.split(' ').at(-1))
      if (this.mode === 'ai') {
        this.startHeartbeat()
      } else {
        this.stopHeartbeat()
        this.drive = 'STOP'
      }
      return
    }

    if (line.startsWith('OK DRIVE')) {
      this.drive = normalizeCommand(line.split(' ').at(-1))
      return
    }

    if (line.startsWith('STATE ')) {
      const pairs = line
        .slice('STATE '.length)
        .split(' ')
        .map(fragment => fragment.split('='))
      for (const [key, value] of pairs) {
        if (key === 'MODE') this.mode = normalizeMode(value)
        if (key === 'DRIVE') this.drive = normalizeCommand(value)
      }
    }
  }

  async disconnect(options = {}) {
    this.stopHeartbeat()
    this.clearManualStopTimer()

    if (!this.port) {
      this.connected = false
      if (!options.preserveMode) {
        this.mode = 'unknown'
      }
      return
    }

    const portToClose = this.port
    this.port = null

    if (portToClose.isOpen) {
      await new Promise(resolve => portToClose.close(() => resolve()))
    }

    this.connected = false
    this.drive = 'STOP'
    if (!options.preserveMode) {
      this.mode = 'unknown'
    }
  }

  async writeLine(line) {
    if (!this.connected || !this.port) {
      await this.connect()
    }

    try {
      await new Promise((resolve, reject) => {
        this.port.write(`${line}\n`, error => {
          if (error) {
            reject(error)
            return
          }

          this.port.drain(drainError => {
            if (drainError) {
              reject(drainError)
              return
            }

            resolve()
          })
        })
      })
    } catch (error) {
      if (!isRetryableSerialError(error)) {
        throw error
      }

      this.lastError = error.message
      await this.disconnect({ preserveMode: true })
      await this.connect(this.portPath)

      await new Promise((resolve, reject) => {
        this.port.write(`${line}\n`, retryError => {
          if (retryError) {
            reject(retryError)
            return
          }

          this.port.drain(drainError => {
            if (drainError) {
              reject(drainError)
              return
            }

            resolve()
          })
        })
      })
    }

    this.lastCommandAt = nowIso()
  }

  clearManualStopTimer() {
    if (this.manualStopTimer) {
      clearTimeout(this.manualStopTimer)
      this.manualStopTimer = null
    }
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) {
        return
      }

      this.writeLine('PING').catch(error => {
        this.lastError = error.message
      })
    }, HEARTBEAT_MS)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  async requestStatus() {
    await this.writeLine('STATUS')
    return this.getStatus()
  }

  async setMode(mode) {
    const targetMode = normalizeMode(mode)
    if (targetMode !== 'line' && targetMode !== 'ai') {
      throw new Error('Mode must be LINE or AI')
    }

    if (this.mode === targetMode && this.connected) {
      await this.requestStatus()
      return this.getStatus()
    }

    this.clearManualStopTimer()
    if (this.connected && this.mode === 'ai') {
      await this.writeLine('DRIVE STOP')
      this.drive = 'STOP'
      await delay(MODE_SWITCH_SETTLE_MS)
    }

    await this.writeLine(`MODE ${targetMode.toUpperCase()}`)
    this.mode = targetMode
    this.drive = 'STOP'
    this.lastDriveIssuedAt = Date.now()
    await delay(MODE_SWITCH_SETTLE_MS)
    await this.requestStatus()

    if (targetMode === 'ai') {
      this.startHeartbeat()
    } else {
      this.stopHeartbeat()
    }

    return this.getStatus()
  }

  async driveCommand(command, options = {}) {
    const normalized = normalizeCommand(command)
    if (this.mode !== 'ai') {
      throw new Error('Switch the robot to AI mode before sending drive commands')
    }

    const now = Date.now()
    if (this.lastDriveIssuedAt && now - this.lastDriveIssuedAt < COMMAND_GUARD_MS) {
      await delay(COMMAND_GUARD_MS - (now - this.lastDriveIssuedAt))
    }

    const isContinuous = options?.continuous === true
    const durationMs = options?.durationMs
    const shouldSettleDirection =
      isMovingCommand(normalized) && isMovingCommand(this.drive) && normalized !== this.drive

    if (shouldSettleDirection) {
      await this.writeLine('DRIVE STOP')
      this.drive = 'STOP'
      this.lastDriveIssuedAt = Date.now()
      await delay(DIRECTION_SETTLE_MS)
    }

    await this.writeLine(`DRIVE ${normalized}`)
    this.drive = normalized
    this.lastDriveIssuedAt = Date.now()
    this.clearManualStopTimer()

    if (normalized !== 'STOP' && !isContinuous) {
      const safeDuration = Math.max(100, Math.min(Number(durationMs) || COMMAND_BURST_MS, 2000))
      this.manualStopTimer = setTimeout(() => {
        this.writeLine('DRIVE STOP').catch(error => {
          this.lastError = error.message
        })
      }, safeDuration)
    }

    return this.getStatus()
  }

  async stop() {
    this.clearManualStopTimer()
    if (this.connected && this.mode === 'ai') {
      await this.writeLine('DRIVE STOP')
      this.drive = 'STOP'
      this.lastDriveIssuedAt = Date.now()
    }
    return this.getStatus()
  }

  async ensureConnected() {
    if (!this.connected || !this.port) {
      await this.connect()
    }
  }

  async getStatus() {
    const availablePorts = await this.listPorts()
    return {
      connected: this.connected,
      portPath: this.portPath,
      baudRate: this.baudRate,
      mode: this.mode,
      drive: this.drive,
      lastError: this.lastError,
      lastMessage: this.lastMessage,
      lastTelemetryAt: this.lastTelemetryAt,
      lastCommandAt: this.lastCommandAt,
      availablePorts,
    }
  }
}

export const robotController = new RobotController()
