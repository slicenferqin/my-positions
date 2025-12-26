export interface NewsItem {
  id: string
  title: string
  content: string
  ctime: number // timestamp in seconds
  brief: string
  reading_num: number
  shareurl: string
  img?: string // Image URL
  subjects?: Array<{
    subject_name: string
    subject_id: string
  }>
  comment_num?: number
  share_num?: number
}

export interface NewsResponse {
  code: number
  msg: string
  data: {
    roll_data: NewsItem[]
    next_max_time: number
  }
}
