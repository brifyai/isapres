import type { ReactNode } from 'react'

interface LegalSection {
  title: string
  body: ReactNode
}

interface LegalDocumentLayoutProps {
  eyebrow: string
  title: string
  summary: string
  effectiveDate: string
  sections: LegalSection[]
}

export function LegalDocumentLayout({
  eyebrow,
  title,
  summary,
  effectiveDate,
  sections,
}: LegalDocumentLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary/30 to-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="rounded-3xl border bg-card p-8 shadow-sm">
          <p className="text-sm font-medium text-primary">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{summary}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-full bg-secondary px-3 py-1">Vigencia: {effectiveDate}</span>
            <a
              href="/"
              className="rounded-full border border-border px-3 py-1 font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Volver al sitio
            </a>
          </div>
        </header>

        <main className="rounded-3xl border bg-card p-8 shadow-sm">
          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.title} className="space-y-3">
                <h2 className="text-xl font-semibold text-foreground">{section.title}</h2>
                <div className="space-y-3 text-sm leading-7 text-muted-foreground">{section.body}</div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
