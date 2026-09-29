"use client";

import {
  Building2,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  EmptyTableRow,
  FieldGroup,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Skeleton,
  SkeletonText,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableNumberCell,
  TableRow,
  Textarea,
} from "@/components/ui";

function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-sm font-semibold tracking-[0.02em] text-ink-500 uppercase dark:text-ink-400">
          {title}
        </h2>
        {note ? (
          <p className="text-xs text-ink-400 dark:text-ink-500">{note}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const PIPELINE = [
  {
    id: "LEAD-0142",
    company: "Northwind Trading",
    value: 48_500,
    stage: "Qualified",
    days: 3,
  },
  { id: "LEAD-0158", company: "Globex", value: 12_000, stage: "New", days: 1 },
  {
    id: "OPP-0031",
    company: "Initech",
    value: 125_000,
    stage: "Proposal",
    days: 14,
  },
  {
    id: "OPP-0029",
    company: "Umbrella Ltd",
    value: 7_400,
    stage: "Won",
    days: 22,
  },
];

export function UiPlayground() {
  const [stage, setStage] = useState("qualified");
  const [rows, setRows] = useState(PIPELINE);

  return (
    <div className="flex flex-col gap-10">
      {/* ── Buttons ─────────────────────────────────────────────────────── */}
      <Section
        title="Button"
        note="Loading keeps the width so the row does not reflow"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">
            <Plus aria-hidden="true" className="size-4" />
            With icon
          </Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add record">
            <Plus aria-hidden="true" className="size-4" />
          </Button>
          <Button disabled>Disabled</Button>
          <Button loading>Save changes</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/dev/ui">Link styled as button</ButtonLink>
        </div>
      </Section>

      {/* ── Badges ──────────────────────────────────────────────────────── */}
      <Section title="Badge" note="Status is the only place colour is correct">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="info">New</Badge>
          <Badge tone="attention" dot>
            Pending
          </Badge>
          <Badge tone="positive" dot>
            Won
          </Badge>
          <Badge tone="critical" dot>
            Overdue
          </Badge>
          <Badge tone="outline" size="sm">
            Filter
          </Badge>
        </div>
      </Section>

      {/* ── Fields ──────────────────────────────────────────────────────── */}
      <Section
        title="Field"
        note="Error reserves its line so the form does not jump"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FieldGroup label="Company name" hint="As it appears on the contract">
            <Input placeholder="Northwind Trading" />
          </FieldGroup>

          <FieldGroup
            label="Work email"
            error="Enter a valid work email address"
          >
            <Input type="email" defaultValue="not-an-email" aria-invalid />
          </FieldGroup>

          <FieldGroup label="Annual revenue" hint="In USD">
            <Input type="number" inputMode="numeric" placeholder="0" />
          </FieldGroup>

          <FieldGroup label="Owner" required error="An owner is required">
            <Input placeholder="Search people" />
          </FieldGroup>

          <FieldGroup label="Notes">
            <Textarea placeholder="Context worth keeping…" />
          </FieldGroup>

          <FieldGroup label="Stage">
            <Select
              value={stage}
              onValueChange={(value) => setStage(value ?? "")}
            >
              <SelectTrigger aria-label="Stage" />
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="proposal">Proposal</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost" disabled>
                  Lost
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
        </div>
      </Section>

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      <Section
        title="Dialog and menu"
        note="AlertDialog has no dismiss affordance on purpose"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger render={<Button>New company</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New company</DialogTitle>
                <DialogDescription>
                  Companies are visible to everyone in this organization.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <FieldGroup label="Company name" required>
                  <Input autoFocus placeholder="Northwind Trading" />
                </FieldGroup>
                <FieldGroup label="Website">
                  <Input type="url" placeholder="https://" />
                </FieldGroup>
              </DialogBody>
              <DialogFooter>
                <DialogClose
                  render={<Button variant="secondary">Cancel</Button>}
                />
                <Button>Create company</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Row actions"
                />
              }
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Northwind Trading</DropdownMenuLabel>
              <DropdownMenuItem>
                <Pencil aria-hidden="true" className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem>
                <UserPlus aria-hidden="true" className="size-3.5" />
                Assign owner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive>
                <Trash2 aria-hidden="true" className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="danger">Delete</Button>}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Northwind Trading?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the company and its 4 pipeline records. The
                  activity log is kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogBody className="text-sm text-ink-600 dark:text-ink-300">
                This cannot be undone.
              </AlertDialogBody>
              <AlertDialogActions
                destructive
                confirmLabel="Delete company"
                onConfirm={() => setRows([])}
              />
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Section>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <Section title="Table" note="Figures are tabular so the column scans">
        <Card variant="outlined">
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            <CardDescription>
              {rows.length > 0
                ? "Most recent activity first"
                : "Nothing here yet"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <Table>
              <TableCaption className="sr-only">
                Open pipeline records and their value
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <EmptyTableRow colSpan={5}>
                    <EmptyState
                      compact
                      icon={Inbox}
                      title="No pipeline records"
                      description="Once a record reaches the proposal stage it will appear here."
                    />
                  </EmptyTableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-ink-500">
                        {row.id}
                      </TableCell>
                      <TableCell className="font-medium text-ink-900 dark:text-ink-50">
                        {row.company}
                      </TableCell>
                      <TableCell>
                        <Badge
                          tone={
                            row.stage === "Won"
                              ? "positive"
                              : row.stage === "Proposal"
                                ? "attention"
                                : "neutral"
                          }
                          dot
                        >
                          {row.stage}
                        </Badge>
                      </TableCell>
                      <TableNumberCell>
                        {row.value.toLocaleString("en-US")}
                      </TableNumberCell>
                      <TableNumberCell className="text-ink-500">
                        {row.days}d
                      </TableNumberCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter className="justify-between">
            <p className="font-mono text-xs text-ink-500 tabular-nums">
              {rows.length} records
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary">
                Export
              </Button>
              <Button size="sm">
                <Plus aria-hidden="true" className="size-3.5" />
                Record
              </Button>
            </div>
          </CardFooter>
        </Card>
      </Section>

      {/* ── States ──────────────────────────────────────────────────────── */}
      <Section
        title="Empty and loading"
        note="Both are designed, not placeholders"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card variant="outlined">
            <EmptyState
              icon={Building2}
              title="No companies yet"
              description="Add the first company to start tracking pipeline, contacts, and activity against it."
              action={<Button size="sm">Add company</Button>}
            />
          </Card>
          <Card variant="outlined" className="flex flex-col gap-3 p-4">
            <Skeleton className="size-9 rounded-full" />
            <SkeletonText lines={3} />
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-20" />
            </div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
