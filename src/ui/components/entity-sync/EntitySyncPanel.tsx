import { useEntitySyncStore } from '../../../graph/store/entity-sync-store';
import { EntitySyncCard } from './EntitySyncCard';

export function EntitySyncPanel() {
  const notifications = useEntitySyncStore((s) => s.notifications.filter((n) => !n.dismissed));
  const dismissNotification = useEntitySyncStore((s) => s.dismissNotification);
  const removeNotification = useEntitySyncStore((s) => s.removeNotification);

  const handleAction = async (notificationId: string, action: string) => {
    if (action === 'dismiss') {
      dismissNotification(notificationId);
      return;
    }
    // IPC calls will be wired in Task 12 via platform layer
    try {
      await (window as any).electronAPI?.invoke('entity-files:resolve-notification', notificationId, action);
      removeNotification(notificationId);
    } catch (err) {
      console.error('[EntitySyncPanel] action failed:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <h3 className="text-xs font-medium text-zinc-300 uppercase tracking-wide">Entity Sync</h3>
        {notifications.length > 0 && (
          <span className="text-[10px] text-zinc-500">{notifications.length} pending</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {notifications.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-8">No sync issues</p>
        ) : (
          notifications.map((n) => (
            <EntitySyncCard key={n.id} notification={n} onAction={handleAction} />
          ))
        )}
      </div>
    </div>
  );
}
