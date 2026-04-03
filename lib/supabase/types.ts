export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_phone_number: string | null
          albi_email: string | null
          staff_notification_emails: string[]
          review_links: Json
          job_types: Json
          auto_send_enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          albi_email?: string | null
          staff_notification_emails?: string[]
          review_links?: Json
          job_types?: Json
          auto_send_enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
          albi_email?: string | null
          staff_notification_emails?: string[]
          review_links?: Json
          job_types?: Json
          auto_send_enabled?: boolean
          created_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          company_id: string
          email: string
          role: 'admin' | 'member'
        }
        Insert: {
          id?: string
          company_id: string
          email: string
          role?: 'admin' | 'member'
        }
        Update: {
          id?: string
          company_id?: string
          email?: string
          role?: 'admin' | 'member'
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      message_plans: {
        Row: {
          id: string
          company_id: string
          trigger_type: 'date_offset' | 'status_change'
          trigger_date_field: string | null
          trigger_offset_days: number | null
          trigger_status_value: string | null
          trigger_job_type_strings: string[] | null
          message_template: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          trigger_type: 'date_offset' | 'status_change'
          trigger_date_field?: string | null
          trigger_offset_days?: number | null
          trigger_status_value?: string | null
          trigger_job_type_strings?: string[] | null
          message_template: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          trigger_type?: 'date_offset' | 'status_change'
          trigger_date_field?: string | null
          trigger_offset_days?: number | null
          trigger_status_value?: string | null
          trigger_job_type_strings?: string[] | null
          message_template?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      jobs: {
        Row: {
          id: string
          company_id: string
          albi_job_id: string
          customer_name: string | null
          customer_phone: string | null
          status: string | null
          created_at_albi: string | null
          inspection_date: string | null
          estimated_work_start_date: string | null
          file_closed: string | null
          estimate_sent: string | null
          contract_signed: string | null
          coc_cos_signed: string | null
          invoiced: string | null
          work_start: string | null
          paid: string | null
          estimated_completion_date: string | null
          albi_project_url: string | null
          raw_csv_row: Json
          imported_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          albi_job_id: string
          customer_name?: string | null
          customer_phone?: string | null
          status?: string | null
          created_at_albi?: string | null
          inspection_date?: string | null
          estimated_work_start_date?: string | null
          file_closed?: string | null
          estimate_sent?: string | null
          contract_signed?: string | null
          coc_cos_signed?: string | null
          invoiced?: string | null
          work_start?: string | null
          paid?: string | null
          estimated_completion_date?: string | null
          albi_project_url?: string | null
          raw_csv_row?: Json
          imported_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          albi_job_id?: string
          customer_name?: string | null
          customer_phone?: string | null
          status?: string | null
          created_at_albi?: string | null
          inspection_date?: string | null
          estimated_work_start_date?: string | null
          file_closed?: string | null
          estimate_sent?: string | null
          contract_signed?: string | null
          coc_cos_signed?: string | null
          invoiced?: string | null
          work_start?: string | null
          paid?: string | null
          estimated_completion_date?: string | null
          albi_project_url?: string | null
          raw_csv_row?: Json
          imported_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      sent_messages: {
        Row: {
          id: string
          company_id: string
          job_id: string | null
          plan_id: string | null
          direction: 'inbound' | 'outbound'
          body: string
          to_phone: string
          from_phone: string
          twilio_sid: string | null
          sent_at: string
        }
        Insert: {
          id?: string
          company_id: string
          job_id?: string | null
          plan_id?: string | null
          direction: 'inbound' | 'outbound'
          body: string
          to_phone: string
          from_phone: string
          twilio_sid?: string | null
          sent_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          job_id?: string | null
          plan_id?: string | null
          direction?: 'inbound' | 'outbound'
          body?: string
          to_phone?: string
          from_phone?: string
          twilio_sid?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          }
        ]
      }
      conversations: {
        Row: {
          id: string
          company_id: string
          job_id: string | null
          customer_phone: string
          last_message_at: string
          unread_count: number
        }
        Insert: {
          id?: string
          company_id: string
          job_id?: string | null
          customer_phone: string
          last_message_at?: string
          unread_count?: number
        }
        Update: {
          id?: string
          company_id?: string
          job_id?: string | null
          customer_phone?: string
          last_message_at?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      do_not_text: {
        Row: {
          id: string
          company_id: string
          phone_number: string
          added_at: string
          added_by: string | null
          reason: string | null
        }
        Insert: {
          id?: string
          company_id: string
          phone_number: string
          added_at?: string
          added_by?: string | null
          reason?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          phone_number?: string
          added_at?: string
          added_by?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "do_not_text_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      pulse_check_runs: {
        Row: {
          id: string
          company_id: string
          message_template: string
          target_statuses: string[]
          target_job_type_strings: string[]
          sent_at: string
          job_ids_sent: string[]
        }
        Insert: {
          id?: string
          company_id: string
          message_template: string
          target_statuses?: string[]
          target_job_type_strings?: string[]
          sent_at?: string
          job_ids_sent?: string[]
        }
        Update: {
          id?: string
          company_id?: string
          message_template?: string
          target_statuses?: string[]
          target_job_type_strings?: string[]
          sent_at?: string
          job_ids_sent?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "pulse_check_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          }
        ]
      }
      signup_requests: {
        Row: {
          id: string
          email: string
          name: string
          requested_company_name: string
          status: 'pending' | 'approved' | 'rejected'
          company_id: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          name: string
          requested_company_name: string
          status?: 'pending' | 'approved' | 'rejected'
          company_id?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          requested_company_name?: string
          status?: 'pending' | 'approved' | 'rejected'
          company_id?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      user_app_access: {
        Row: {
          id: string
          user_id: string
          app_name: string
          role: string
          granted_at: string
        }
        Insert: {
          id?: string
          user_id: string
          app_name: string
          role?: string
          granted_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          app_name?: string
          role?: string
          granted_at?: string
        }
        Relationships: []
      }
      send_queue: {
        Row: {
          id: string
          company_id: string
          job_id: string
          plan_id: string
          resolved_message: string
          queued_at: string
          status: 'pending' | 'sent' | 'skipped'
          skipped_reason: string | null
          processed_at: string | null
        }
        Insert: {
          id?: string
          company_id: string
          job_id: string
          plan_id: string
          resolved_message: string
          queued_at?: string
          status?: 'pending' | 'sent' | 'skipped'
          skipped_reason?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          company_id?: string
          job_id?: string
          plan_id?: string
          resolved_message?: string
          queued_at?: string
          status?: 'pending' | 'sent' | 'skipped'
          skipped_reason?: string | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "send_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_queue_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_queue_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "message_plans"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_company_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      increment_unread: {
        Args: { conversation_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience types
export type Company = Database['public']['Tables']['companies']['Row']
export type User = Database['public']['Tables']['users']['Row']
export type MessagePlan = Database['public']['Tables']['message_plans']['Row']
export type Job = Database['public']['Tables']['jobs']['Row']
export type SentMessage = Database['public']['Tables']['sent_messages']['Row']
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type DoNotText = Database['public']['Tables']['do_not_text']['Row']
export type PulseCheckRun = Database['public']['Tables']['pulse_check_runs']['Row']
export type SendQueue = Database['public']['Tables']['send_queue']['Row']
export type SignupRequest = Database['public']['Tables']['signup_requests']['Row']
