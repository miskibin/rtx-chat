import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { ModeToggle } from "@/components/mode-toggle"

interface PageHeaderProps {
  title: string
  badge?: number | string
  children?: React.ReactNode // for right-side actions
}

export function PageHeader({ title, badge, children }: PageHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 shrink-0">
      <SidebarTrigger />
      <div className="flex items-center gap-2">
        <span className="text-xl font-semibold">{title}</span>
        {badge !== undefined && (
          <Badge variant="secondary" className="rounded-md">{badge}</Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ModeToggle />
      </div>
    </header>
  )
}

