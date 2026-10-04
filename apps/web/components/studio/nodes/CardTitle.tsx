'use client';

import { useContext, useState } from 'react';
import { NodeActionContext } from './context';

/** 卡片标题：显示 config.title（空则回退类型名）；双击行内编辑，Enter/失焦保存，Esc 取消。 */
export function CardTitle(props: { nodeId: string; title: string; fallback: string }) {
  const actions = useContext(NodeActionContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const save = () => {
    setEditing(false);
    const v = draft.trim().slice(0, 64);
    if (v !== props.title) actions.updateConfig(props.nodeId, 'title', v);
  };

  if (!editing) {
    return (
      <span
        className="studio-card-title"
        title="双击重命名"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(props.title);
          setEditing(true);
        }}
      >
        {props.title.trim() || props.fallback}
      </span>
    );
  }
  return (
    <input
      className="studio-card-title-input nodrag"
      autoFocus
      value={draft}
      maxLength={64}
      placeholder={props.fallback}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          save();
        }
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
