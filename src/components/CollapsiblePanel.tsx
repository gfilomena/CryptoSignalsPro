import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'

interface Props {
  id: string
  sectionClassName: string
  headerClassName: string
  title: ReactNode
  rightSlot?: ReactNode
  defaultCollapsed?: boolean
  children: ReactNode
}

export function CollapsiblePanel({
  id,
  sectionClassName,
  headerClassName,
  title,
  rightSlot,
  defaultCollapsed = true,
  children,
}: Props) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const bodyId = `${id}Body`

  return (
    <div className={`${sectionClassName} ${collapsed ? 'is-collapsed' : ''}`} id={id}>
      <div className={headerClassName}>
        {title}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {rightSlot}
          <button
            type="button"
            className="collapsible-toggle"
            title={t('collapsible.toggle')}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>
      <div className={`collapsible-body ${collapsed ? 'collapsed' : ''}`} id={bodyId}>
        {children}
      </div>
    </div>
  )
}
