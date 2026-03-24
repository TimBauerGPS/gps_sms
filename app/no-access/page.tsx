export default function NoAccessPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-white mb-3">Access Not Granted</h1>
        <p className="text-slate-400 mb-6">
          Your account doesn&apos;t have access to Guardian SMS. Please contact your administrator to request access.
        </p>
        <a
          href="/login"
          className="inline-block px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Login
        </a>
      </div>
    </div>
  )
}
