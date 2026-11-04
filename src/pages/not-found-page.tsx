import { FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"

export function NotFoundPage() {
  return (
    <Card className="mt-2">
      <EmptyState
        icon={FileQuestion}
        title="This page does not exist"
        description="The link may be out of date, or the record may have been moved to another module."
        action={
          <Button asChild variant="outline">
            <a href="#/dashboard">Back to dashboard</a>
          </Button>
        }
      />
    </Card>
  )
}
