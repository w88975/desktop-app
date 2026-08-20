import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import { getVisibleSettingsPages } from './settings-registry'

interface SettingsNavigatorProps {
  selectedSubpage: SettingsSubpage
  onSelectSubpage(subpage: SettingsSubpage): void
}

export default function SettingsNavigator({ selectedSubpage, onSelectSubpage }: SettingsNavigatorProps) {
  const { t } = useTranslation()
  const pages = useMemo(() => getVisibleSettingsPages(), [])

  return (
    <nav className="flex h-full flex-col overflow-y-auto" aria-label="设置分类">
      <div className="pt-2">
        {pages.map((page, index) => {
          const Icon = page.icon
          const selected = selectedSubpage === page.id
          return (
            <div key={page.id} className="settings-item" data-selected={selected || undefined}>
              {index > 0 && <div className="settings-separator pl-10 pr-4"><Separator /></div>}
              <div className="settings-content select-none pl-2 mr-2">
                <button
                  type="button"
                  onClick={() => onSelectSubpage(page.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[8px] px-3 py-3 text-left text-sm outline-none',
                    'transition-[background-color] duration-75',
                    selected ? 'bg-foreground/5 hover:bg-foreground/7' : 'hover:bg-foreground/2',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-foreground' : 'text-muted-foreground')} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className={cn('font-medium', selected ? 'text-foreground' : 'text-foreground/80')}>
                      {t(page.labelKey)}
                    </span>
                    <span className="line-clamp-1 text-xs text-foreground/60">{t(page.descriptionKey)}</span>
                  </div>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
