import { useState } from 'react'
import { Button } from '../ui'
import DataTable from './DataTable'
import { ActionMsg, FormFields, Load, Modal, Small, coerce, useAction } from './kit'
import { deleteRow, insertRow, rows as loadRows, updateRow } from '../../services/manage'

// List + add + edit + delete for a simple table. Row Level Security decides what the user may change;
// a refusal comes back as an error message here.
export default function CrudPanel({ table, select = '*', query = (q) => q, columns, fields, title, defaults = {}, canEdit = true,
  canDelete = true, toForm = (r) => r, fromForm = (v) => v, extraActions, deps = [], addLabel = 'Add', idKey = 'id' }) {
  const [editing, setEditing] = useState(null)
  return (
    <Load loader={() => loadRows(table, select, query)} deps={[table, select, ...deps]}>
      {(list, reload) => (
        <>
          <DataTable title={title} rows={list} columns={[...columns, ...(canEdit || extraActions ? [{
            key: '_actions', label: '', noExport: true, noSort: true, render: (r) => (
              <span className="flex flex-wrap justify-end gap-1">
                {extraActions?.(r, reload)}
                {canEdit && <Small onClick={() => setEditing(r)}>Edit</Small>}
              </span>
            ),
          }] : [])]} filters={canEdit && <Button className="!py-1.5" onClick={() => setEditing({ ...defaults })}>{addLabel}</Button>} />
          {editing && <EditModal table={table} title={title} fields={fields} row={editing} toForm={toForm} fromForm={fromForm}
            canDelete={canDelete} idKey={idKey} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
        </>
      )}
    </Load>
  )
}

function EditModal({ table, title, fields, row, toForm, fromForm, canDelete, idKey, onClose, onSaved }) {
  const key = row[idKey]
  const [value, setValue] = useState(() => toForm(row))
  const a = useAction()
  const save = async (e) => {
    e.preventDefault()
    const data = fromForm(coerce(fields, value), value)
    // the primary key is never part of an update (some tables only grant updates on named columns)
    const { [idKey]: _key, ...patch } = data
    const ok = await a.run(() => (key ? updateRow(table, key, patch, idKey) : insertRow(table, data)))
    if (ok) onSaved()
  }
  const remove = async () => {
    if (!window.confirm('Delete this record?')) return
    if (await a.run(() => deleteRow(table, key, idKey))) onSaved()
  }
  return (
    <Modal title={`${key ? 'Edit' : 'Add'} ${title.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <FormFields fields={fields} value={value} onChange={setValue} />
        <ActionMsg action={a} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={a.busy}>{a.busy ? 'Saving…' : 'Save'}</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {key && canDelete && <Button variant="danger" className="ml-auto" onClick={remove}>Delete</Button>}
        </div>
      </form>
    </Modal>
  )
}
