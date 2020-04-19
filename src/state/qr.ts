import { getQRData, getTagData } from '../api'
import { useEffect, useState, useReducer, useRef } from 'react'
import moment from 'moment-timezone'
import 'moment/locale/th'
import AsyncStorage from '@react-native-community/async-storage'
import { applicationState } from './app-state'
interface QRData {
  data: {
    anonymousId: string
    code: string
    tag?: Tag    
  }
  qr: {
    type: string
    base64: string
  }
}

export enum QR_STATE {
  LOADING = 'loading',
  FAILED = 'failed',
  NORMAL = 'normal',
  OUTDATE = 'outdate',
  EXPIRE = 'expire',
  NOT_VERIFIED = 'not_verified'
}
enum QR_ACTION {
  UPDATE = 'update',
  LOADING = 'loading'
}

type SelfQRType = {
  qrData: SelfQR,
  qrState: QR_STATE,
  error: any,
}

export const useSelfQR = () => {
  const [state, dispatch] = useReducer<(state: SelfQRType, action: any) => SelfQRType>(
    (state, action) => {
      switch (action.type) {
        case QR_ACTION.LOADING:
          return { ...state, qrState: QR_STATE.LOADING }
        case QR_ACTION.UPDATE:
          return { ...state, ...action.payload }
        default:
          return state
      }
    },
    {
      qrData: null,
      qrState: QR_STATE.LOADING,
      error: null,
    },
  )
  const tlRef = useRef<NodeJS.Timeout>()  

  const refreshQR = async () => {
    clearTimeout(tlRef.current)
    try {
      dispatch({
        type: QR_ACTION.LOADING
      })
      const _qrData = await getQRData()
      const qrData = await SelfQR.setCurrentQRFromQRData(_qrData)
      const qrState = SelfQR.getCurrentState()
      dispatch({
        type: QR_ACTION.UPDATE,
        payload: { qrData, qrState, error: null },
      })
      tlRef.current = setTimeout(refreshQR, 2 * 60 * 1000) // Update after 2 min
    } catch (error) {
      const qrState = SelfQR.getCurrentState()
      dispatch({
        type: QR_ACTION.UPDATE,
        payload: { qrState, error },
      })
      tlRef.current = setTimeout(refreshQR, 10 * 1000) // Retry after 10 sec
    }
  }
  
  useEffect(() => {
    

    const setQRFromStorage = async () => {
      const qrData = await SelfQR.getCurrentQR()
      dispatch({ type: QR_ACTION.UPDATE, payload: { qrData } })
    }

    setQRFromStorage().then(() => refreshQR())
    return () => {
      clearTimeout(tlRef.current)
    }
  }, [])

  return { ...state, refreshQR }
}

class QR {
  code: string
  constructor(code) {
    this.code = code
  }
  getStatusColor() {
    return STATUS_COLORS[this.code]
  }
  getLevel() {
    return LEVELS[this.code]
  }
  getScore() {
    return SCORES[this.code]
  }
  getLabel() {
    return LABELS[this.code]
  }
}

interface Tag {
  id: string
  title: string
  description: string
  color: string
}

class SelfQR extends QR {
  qrData: QRData
  code: string
  tag?: Tag  
  timestamp: number

  private static currentQR: SelfQR = null

  public static async getCurrentQR() {
    if (!this.currentQR) {
      try {
        const selfQRData = await AsyncStorage.getItem('selfQRData')
        if (selfQRData) {
          this.currentQR = new SelfQR(
            JSON.parse(selfQRData),
          )
        }
      } catch (error) {
        console.log(error)
      }
    }
    return this.currentQR
  }

  public static async setCurrentQRFromQRData(qrData: QRData) {
    try {
      await AsyncStorage.setItem('selfQRData', JSON.stringify(qrData))
    } catch (error) {
      console.log(error)
    }
    this.currentQR = new SelfQR(qrData)
    return this.currentQR
  }

  public static getCurrentState() {
    if (!this.currentQR) {
      return QR_STATE.FAILED
    }
    const time = Date.now() - this.currentQR.timestamp
    if (time < 3 * 60 * 1000) {
      return QR_STATE.NORMAL
    }
    if (time < 10 * 60 * 1000) {
      return QR_STATE.OUTDATE
    }
    return QR_STATE.EXPIRE
  }

  constructor(qrData: QRData) {
    super(qrData.data.code)
    this.qrData = qrData
    this.timestamp = Date.now()
    this.tag = qrData.data?.tag
  }
  getAnonymousId() {
    return this.qrData.data.anonymousId
  }
  getQRImageURL() {
    return `data:${this.qrData.qr.type};base64,` + this.qrData.qr.base64
  }
  getCreatedDate(): moment {
    return moment(this.timestamp).locale('th')
  }
  getTagLabel(): string | undefined {
    return this.tag?.title
  }
  getTagColor() {
    return this.tag?.color || '#0C2641'
  }
}

interface DecodedResult {
  _: [string, 'G' | 'Y' | 'O' | 'R', string | undefined, number | undefined]
  iat: number
  iss: string
}
export class QRResult extends QR {
  iat: number
  code: string
  annonymousId: string
  tagCode?: string
  age?: number
  iss: string
  constructor(decodedResult: DecodedResult) {
    console.log('decodedResult', decodedResult)
    super(CODE_MAP[decodedResult._[1]])
    this.annonymousId = decodedResult._[0]
    this.tagCode = decodedResult._[2]
    this.age = decodedResult._[3]
    this.iat = decodedResult.iat
    this.iss = decodedResult.iss
  }
  getUserCreatedDate() {
    if (!this.age) {
      return null
    }
    return moment().subtract(this.age, 'days').locale('th')
  }
  getCreatedDate(): moment {
    return moment(this.iat * 1000).locale('th')
  }
  getTagLabel(): string | undefined {
    return this.tagCode? tagManager.getLabelFromCode(this.tagCode): void 0
  }
}

const STATUS_COLORS = {
  green: '#27C269',
  yellow: '#E5DB5C',
  orange: '#E18518',
  red: '#EC3131',
  DEFAULT: '#B4B5C1',
}
const LEVELS = {
  green: 1,
  yellow: 2,
  orange: 3,
  red: 4,
}
const SCORES = {
  green: 100,
  yellow: 80,
  orange: 50,
  red: 30,
}
const LABELS = {
  green: 'ความเสี่ยงต่ำมาก',
  yellow: 'ความเสี่ยงน้อย',
  orange: 'ความเสี่ยงปานกลาง',
  red: 'ความเสี่ยงสูงมาก',
}
const CODE_MAP = {
  G: 'green',
  Y: 'yellow',
  O: 'orange',
  R: 'red',
}
const GEN_ACTION = 'ล้างมือ สวมหน้ากาก หลีกเลี่ยงที่แออัด'
const SPEC_ACTIONS = {
  YELLOW: 'อาจเป็นโรคอื่น ถ้า 2 วัน อาการไม่ดีขึ้นให้ไปพบแพทย์',
  ORANGE:
    'เนื่องจากท่านมีประวัติเดินทางจากพื้นที่เสี่ยง ให้กักตัว 14 วัน พร้อมเฝ้าระวังอาการ ถ้ามีอาการไข้ ร่วมกับ อาการระบบทางเดินหายใจ ให้ติดต่อสถานพยาบาลทันที',
  RED: 'ให้ติดต่อสถานพยาบาลทันที',
}

type TagMap = {
  name: string
  code: string
  label: string
}[]

class TagManager {
  tagMap?: TagMap
  constructor() {
    this.load()
  }
  async load() {
    const str = await AsyncStorage.getItem('TagMap')
    if (str) {
      this.tagMap = JSON.parse(str)
    }
  }
  async update() {
    const result: TagMap = await getTagData()
    this.tagMap = result
    AsyncStorage.setItem('TagMap', JSON.stringify(this.tagMap))
  }
  getLabelFromCode(code) {
    if (!this.tagMap) {
      return
    }
    return this.tagMap.find(p => p.code === code)?.label
  }
}

export const tagManager = new TagManager()
