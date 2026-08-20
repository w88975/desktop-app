/**
 * HeaderMenu
 *
 * A "..." dropdown menu for panel headers.
 * Pass page-specific menu items as children; they appear above documentation.
 * Optionally includes a "Learn More" link to documentation when helpFeature is provided.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, ExternalLink } from 'lucide-react'
import { HeaderIconButton } from './HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from './styled-dropdown'
import { type DocFeature, getDocUrl } from '@craft-agent/shared/docs/doc-links'

interface HeaderMenuProps {
  /** Page-specific menu items (rendered before Open in New Window) */
  children?: React.ReactNode
  /** Documentation feature - when provided, adds a "Learn More" link to docs */
  helpFeature?: DocFeature
}

export function HeaderMenu({ children, helpFeature }: HeaderMenuProps) {
  const { t } = useTranslation()

  const handleLearnMore = helpFeature ? () => {
    window.electronAPI?.openUrl(getDocUrl(helpFeature))
  } : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {children}
        {helpFeature && (
          <>
            {children && <StyledDropdownMenuSeparator />}
            <StyledDropdownMenuItem onClick={handleLearnMore}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="flex-1">{t("common.learnMore")}</span>
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
