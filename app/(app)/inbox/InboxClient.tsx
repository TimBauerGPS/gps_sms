'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Conversation, SentMessage, Job } from '@/lib/supabase/types'

// ─── Extended types ────────────────────────────────────────────────────────────

type ConversationWithJob = Conversation & {
  job: Pick<Job, 'id' | 'customer_name' | 'albi_job_id'> | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  const date = new Date(ts)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()

  if (isYesterday) return 'Yesterday'

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatMessageTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function conversationLabel(conv: ConversationWithJob): string {
  if (conv.job?.customer_name) return conv.job.customer_name
  return conv.customer_phone
}

function conversationSubLabel(conv: ConversationWithJob): string {
  if (conv.job?.albi_job_id) return conv.job.albi_job_id
  return conv.customer_phone
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function InboxClient() {
  const supabase = createClient()

  // State
  const [conversations, setConversations] = useState<ConversationWithJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SentMessage[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null)
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null

  // ─── Bootstrap: get company ID ──────────────────────────────────────────────

  useEffect(() => {
    async function bootstrap() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: userRow } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single()

      if (userRow) setCompanyId(userRow.company_id)
    }
    bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Check notification permission ──────────────────────────────────────────

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission)
    }
  }, [])

  // ─── Fetch conversations ─────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    if (!companyId) return
    setLoadingConvs(true)
    const { data, error } = await supabase
      .from('conversations')
      .select(
        `
        id,
        company_id,
        job_id,
        customer_phone,
        last_message_at,
        unread_count,
        job:jobs ( id, customer_name, albi_job_id )
      `
      )
      .eq('company_id', companyId)
      .order('last_message_at', { ascending: false })

    if (!error && data) {
      // Supabase returns joined rows as arrays when using select with relation;
      // normalise so job is always a single object or null.
      const normalised = (data as unknown[]).map((row) => {
        const r = row as ConversationWithJob & { job: ConversationWithJob['job'] | ConversationWithJob['job'][] }
        return {
          ...r,
          job: Array.isArray(r.job) ? (r.job[0] ?? null) : r.job,
        } as ConversationWithJob
      })
      setConversations(normalised)
    }
    setLoadingConvs(false)
  }, [companyId, supabase])

  useEffect(() => {
    if (companyId) fetchConversations()
  }, [companyId, fetchConversations])

  // ─── Fetch messages for selected conversation ────────────────────────────────

  const fetchMessages = useCallback(
    async (conv: ConversationWithJob) => {
      setLoadingMsgs(true)
      setMessages([])
      const phone = conv.customer_phone

      const { data, error } = await supabase
        .from('sent_messages')
        .select('*')
        .eq('company_id', conv.company_id)
        .or(`to_phone.eq.${phone},from_phone.eq.${phone}`)
        .order('sent_at', { ascending: true })

      if (!error && data) {
        setMessages(data)
      }
      setLoadingMsgs(false)
    },
    [supabase]
  )

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // ─── Auto-scroll to bottom when messages change ──────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─── Mark conversation as read ───────────────────────────────────────────────

  const markAsRead = useCallback(
    async (convId: string) => {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', convId)

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c))
      )
    },
    [supabase]
  )

  // ─── Handle conversation select ──────────────────────────────────────────────

  const handleSelectConversation = (conv: ConversationWithJob) => {
    setSelectedId(conv.id)
    setSendError(null)
    if (conv.unread_count > 0) markAsRead(conv.id)
  }

  // ─── Realtime subscription ───────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`inbox-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sent_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const newMsg = payload.new as SentMessage

          // Update conversation list (bump last_message_at, increment unread for inbound)
          setConversations((prev) => {
            const phone = newMsg.direction === 'inbound' ? newMsg.from_phone : newMsg.to_phone
            const idx = prev.findIndex((c) => c.customer_phone === phone)
            if (idx === -1) {
              // New conversation arrived — refetch
              fetchConversations()
              return prev
            }
            const updated = [...prev]
            const conv = { ...updated[idx] }
            conv.last_message_at = newMsg.sent_at
            if (newMsg.direction === 'inbound' && conv.id !== selectedId) {
              conv.unread_count = conv.unread_count + 1
            }
            updated.splice(idx, 1)
            return [conv, ...updated]
          })

          // Append to open thread if it belongs to the selected conversation
          setMessages((prev) => {
            if (!selectedConversation) return prev
            const phone = selectedConversation.customer_phone
            if (newMsg.from_phone === phone || newMsg.to_phone === phone) {
              // Avoid duplicates (optimistic update may have already added it)
              if (prev.some((m) => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            }
            return prev
          })

          // Browser notification for inbound messages when tab is hidden
          if (
            newMsg.direction === 'inbound' &&
            typeof document !== 'undefined' &&
            document.hidden &&
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            const conv = conversations.find((c) => c.customer_phone === newMsg.from_phone)
            const title = conv ? conversationLabel(conv) : newMsg.from_phone
            new Notification(`New message from ${title}`, {
              body: newMsg.body,
              tag: `inbox-${newMsg.from_phone}`,
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedId, conversations, supabase])

  // ─── Send reply ──────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!selectedConversation || !replyText.trim() || sending) return
    setSending(true)
    setSendError(null)

    // Optimistic update
    const optimisticMsg: SentMessage = {
      id: `optimistic-${Date.now()}`,
      company_id: selectedConversation.company_id,
      job_id: selectedConversation.job_id,
      plan_id: null,
      direction: 'outbound',
      body: replyText.trim(),
      to_phone: selectedConversation.customer_phone,
      from_phone: '',
      twilio_sid: null,
      sent_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])
    const textToSend = replyText.trim()
    setReplyText('')

    try {
      const res = await fetch('/api/inbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedConversation.id,
          message: textToSend,
        }),
      })

      const json = await res.json()

      if (!res.ok || !json.success) {
        // Roll back optimistic message
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
        setReplyText(textToSend)
        setSendError(json.error ?? 'Failed to send message. Please try again.')
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
      setReplyText(textToSend)
      setSendError('Network error. Please check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  // ─── Keyboard handler for textarea ──────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ─── Notification opt-in ─────────────────────────────────────────────────────

  const handleEnableNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  const showNotifBanner =
    notifPermission === 'default' && !notifBannerDismissed

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0)

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* ── Left panel: conversation list ───────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-slate-200">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">Inbox</h1>
          {totalUnread > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-medium">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </div>

        {/* Push notification opt-in banner */}
        {showNotifBanner && (
          <div className="mx-3 mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
            <p className="text-blue-800 mb-2 leading-snug">
              Enable push notifications to get alerted when customers reply
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleEnableNotifications}
                className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                Enable
              </button>
              <button
                onClick={() => setNotifBannerDismissed(true)}
                className="px-3 py-1 rounded-md text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              Loading…
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm px-4 text-center">
              No conversations yet
            </div>
          ) : (
            <ul>
              {conversations.map((conv) => {
                const isSelected = conv.id === selectedId
                return (
                  <li key={conv.id}>
                    <button
                      onClick={() => handleSelectConversation(conv)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-slate-100' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {conversationLabel(conv)}
                          </p>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {conversationSubLabel(conv)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="text-xs text-slate-400">
                            {formatTimestamp(conv.last_message_at)}
                          </span>
                          {conv.unread_count > 0 && (
                            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-xs font-medium">
                              {conv.unread_count > 9 ? '9+' : conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right panel: message thread ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedConversation ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
            <svg
              className="w-12 h-12 mb-3 text-slate-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-sm font-medium">Select a conversation</p>
            <p className="text-xs mt-1 text-slate-300">
              Choose a thread from the left to view messages
            </p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white">
              <div>
                <h2 className="text-base font-semibold text-slate-900 leading-tight">
                  {conversationLabel(selectedConversation)}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedConversation.customer_phone}
                  {selectedConversation.job?.albi_job_id && (
                    <span className="ml-2 text-slate-400">
                      · {selectedConversation.job.albi_job_id}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Message thread */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {loadingMsgs ? (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                  Loading messages…
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-300 text-sm">
                  No messages yet
                </div>
              ) : (
                messages.map((msg) => {
                  const isOutbound = msg.direction === 'outbound'
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[70%] ${isOutbound ? 'items-end' : 'items-start'} flex flex-col`}>
                        <div
                          className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            isOutbound
                              ? 'bg-blue-600 text-white rounded-br-sm'
                              : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                          }`}
                        >
                          {msg.body}
                        </div>
                        <span className="text-xs text-slate-400 mt-1 px-1">
                          {formatMessageTime(msg.sent_at)}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply box */}
            <div className="border-t border-slate-200 px-4 py-3 bg-white">
              {sendError && (
                <div className="mb-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
                  {sendError}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                    className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    disabled={sending}
                    maxLength={1600}
                  />
                  <span className="absolute bottom-2 right-2 text-xs text-slate-300 pointer-events-none select-none">
                    {replyText.length}/1600
                  </span>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!replyText.trim() || sending}
                  className="flex-shrink-0 mb-0.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
