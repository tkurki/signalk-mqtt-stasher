/*
 * Copyright 2016 Teppo Kurki <teppo.kurki@iki.fi>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

const id = 'signalk-mqtt-stasher'
const mqtt = require('mqtt')
const NeDBStore = require('mqtt-nedb-store')
const path = require('path')

const nonAlphaNumerics = /((?![a-zA-Z0-9]).)/g

module.exports = function (app) {
  var plugin = {
    unsubscribes: []
  }
  var server

  plugin.id = id
  plugin.name = 'MQTT Stasher'
  plugin.description = 'Send self data to Stash via MQTT'

  plugin.schema = {
    title: plugin.name,
    type: 'object',
    required: ['targets'],
    properties: {
      targets: {
        type: 'array',
        default: [],
        items: {
          type: 'object',
          required: ['remoteHost'],
          properties: {
            remoteHost: {
              type: 'string',
              title: 'MQTT server Url (starts with mqtt/mqtts)',
              default: 'mqtt://somehost:someport'
            },
            username: {
              type: 'string',
              title: 'MQTT server username'
            },
            password: {
              type: 'string',
              title: 'MQTT server password'
            },
            rejectUnauthorized: {
              type: 'boolean',
              default: false,
              title: 'Reject self signed and invalid server certificates'
            },
            topic: {
              type: 'string',
              default: `signalk/delta/${app.selfId}`,
              title: 'Topic to publish to'
            },
            bufferTime: {
              type: 'integer',
              default: 5,
              title: 'Send buffering interval in seconds'
            },
            sendAll: {
              type: 'boolean',
              default: true,
              title: 'Send all data (add individual paths below if unchecked)'
            },
            paths: {
              type: 'array',
              title:
                "Signal K self paths to send (used when 'Send all data' is unchecked)",
              default: [{ path: 'navigation.position', interval: 60 }],
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    title: 'Path'
                  },
                  interval: {
                    type: 'number',
                    title:
                      'Minimum interval between updates for this path to be sent to the server'
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  plugin.onStop = []

  plugin.start = function (options) {
    plugin.onStop = []

    plugin.clientsData = options.targets.map(target => {
      const dbPath = path.join(
        app.getDataDirPath(),
        target.remoteHost.replace(nonAlphaNumerics, '_')
      )
      const manager = NeDBStore(dbPath)
      const client = mqtt.connect(
        target.remoteHost,
        {
          rejectUnauthorized: options.rejectUnauthorized,
          reconnectPeriod: 60000,
          clientId: app.selfId,
          outgoingStore: manager.outgoing,
          username: target.username,
          password: target.password
        }
      )

      const result = {
        client
      }

      client.on('connect', () => {
        result.connected = true
        console.log(`${target.remoteHost} connected`)
      })
      client.on('error', err => console.error(err))
      client.on('disconnect', () => {
        result.connected = false
        console.log(`${target.remoteHost} disconnected`)
      })

      let updatesAccumulator = []
      const deltaHandler = delta => {
        if (delta.context && delta.context === app.selfContext) {
          updatesAccumulator = updatesAccumulator.concat(delta.updates)
          if (updatesAccumulator.length > 20) {
            client.publish(
              target.topic,
              JSON.stringify({ updates: updatesAccumulator })
            )
            updatesAccumulator = []
          }
        }
      }
      app.signalk.on('delta', deltaHandler)
      plugin.onStop.push(() =>
        app.signalk.removeListener('delta', deltaHandler)
      )

      return result
    })
    started = true
  }

  plugin.stop = function () {
    plugin.onStop.forEach(f => f())
  }

  return plugin
}
