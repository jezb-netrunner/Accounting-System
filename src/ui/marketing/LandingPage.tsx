import { Link } from '@tanstack/react-router'

/**
 * Static marketing site at "/". Original copy and layout — describes the
 * product without borrowing anyone else's text or design.
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="inline-block h-8 w-8 rounded-lg bg-brand-600 text-center text-lg font-bold leading-8 text-white">
            ₱
          </span>
          <span className="text-lg font-semibold tracking-tight">PH Books</span>
        </div>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#how" className="text-slate-600 hover:text-slate-900">
            How it works
          </a>
          <a href="#profiles" className="text-slate-600 hover:text-slate-900">
            Who it's for
          </a>
          <Link
            to="/app"
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
          >
            Open the app
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-16 pt-14 text-center">
          <p className="mb-4 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            Double-entry books · BIR returns · EOPT-ready
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Books that always balance. Returns that match your registration.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            PH Books is bookkeeping and tax filing built around one idea: your BIR
            Certificate of Registration should drive everything. Set up your tax
            profile once — entity type, VAT or percentage tax, withholding roles,
            fiscal year — and every sheet, journal, and deadline follows from it.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/onboarding"
              className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700"
            >
              Set up your company
            </Link>
            <Link
              to="/app"
              className="rounded-lg border border-slate-300 px-6 py-3 font-medium text-slate-700 hover:bg-slate-50"
            >
              Explore the demo companies
            </Link>
          </div>
        </section>

        <section id="how" className="border-t border-slate-100 bg-slate-50 py-16">
          <div className="mx-auto grid max-w-5xl gap-8 px-6 sm:grid-cols-3">
            <Feature
              title="Enter it like a spreadsheet"
              body="Sales, purchases, payroll, and journals are keyboard-first grids. Tab through cells, paste straight from Excel, and watch VAT and withholding derive per line as you type."
            />
            <Feature
              title="Post it, and it's permanent"
              body="A posted sheet becomes one balanced journal entry — append-only, immutable, reversible only by a new entry. Your trial balance ties because nothing unbalanced can exist."
            />
            <Feature
              title="File what you actually owe"
              body="The filing calendar reads your registration: a VAT corporation sees its 2550Q and 1601-C; an 8% professional sees a 1701A and no percentage tax at all. Deadlines are computed, including fiscal years that don't end in December."
            />
          </div>
        </section>

        <section id="profiles" className="py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-2xl font-bold">One app, every taxpayer shape</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">
              Sole proprietors, professionals, partnerships, corporations, cooperatives,
              non-profits — with any mix of VAT, percentage tax, withholding roles,
              incentives, and fiscal years. Rates and thresholds are versioned data, so
              prior periods compute with the rules that applied then.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              <ProfileCard
                name="Narra Trading Corp."
                tag="VAT · RCIT · payroll"
                body="A domestic corporation with output VAT, input VAT on rent, expanded withholding, and monthly compensation withholding."
              />
              <ProfileCard
                name="Reyes Dental Clinic"
                tag="8% option · non-VAT"
                body="A self-employed professional on the 8% income tax option — no VAT, no percentage tax return, one annual 1701A."
              />
              <ProfileCard
                name="Aling Nena's Store"
                tag="Percentage tax · OSD"
                body="A sole proprietor on graduated rates with OSD, filing a quarterly 2551Q and withholding on rent."
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 py-8 text-center text-sm text-slate-500">
        PH Books — an open scaffold for Philippine bookkeeping &amp; BIR filing. Runs
        entirely in your browser today; sync arrives with the Supabase adapter.
      </footer>
    </div>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-100">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  )
}

function ProfileCard({ name, tag, body }: { name: string; tag: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{tag}</p>
      <h3 className="mt-1 font-semibold">{name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  )
}
