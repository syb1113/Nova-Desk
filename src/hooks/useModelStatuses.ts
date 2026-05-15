import { useQuery } from '@tanstack/react-query'
import { listModelStatuses } from '../api/models'

export const useModelStatuses = () => {
  return useQuery({
    queryKey: ['model-statuses'],
    queryFn: listModelStatuses,
  })
}
