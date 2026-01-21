# Color Migration Script
# This script replaces all orange colors with the new red/gold theme

$files = @(
    "d:\MATAM\screens\UserProfileScreen.tsx",
    "d:\MATAM\screens\OtpScreen.tsx",
    "d:\MATAM\screens\OrderConfirmationScreen.tsx",
    "d:\MATAM\screens\MyOrdersScreen.tsx",
    "d:\MATAM\screens\MealDetailsScreen.tsx",
    "d:\MATAM\screens\LoginScreen.tsx",
    "d:\MATAM\screens\CheckoutScreen.tsx",
    "d:\MATAM\screens\CartScreen.tsx",
    "d:\MATAM\screens\admin\SettingsScreen.tsx",
    "d:\MATAM\screens\admin\ManageItemsScreen.tsx",
    "d:\MATAM\screens\admin\ManageCouponsScreen.tsx",
    "d:\MATAM\screens\admin\ManageAdsScreen.tsx",
    "d:\MATAM\screens\admin\ManageAddonsScreen.tsx",
    "d:\MATAM\screens\admin\AdminProfileScreen.tsx",
    "d:\MATAM\screens\admin\AdminLayout.tsx",
    "d:\MATAM\components\HeroBanner.tsx",
    "d:\MATAM\components\RatingModal.tsx",
    "d:\MATAM\components\admin\charts\HorizontalBarChart.tsx",
    "d:\MATAM\components\admin\charts\BarChart.tsx",
    "d:\MATAM\components\admin\CouponFormModal.tsx",
    "d:\MATAM\components\admin\ManagePointsModal.tsx",
    "d:\MATAM\components\admin\AdFormModal.tsx",
    "d:\MATAM\components\admin\AddonFormModal.tsx"
)

# Color replacements
$replacements = @{
    # Background colors
    "bg-orange-50" = "bg-gold-50"
    "bg-orange-100" = "bg-gold-100"
    "bg-orange-200" = "bg-gold-200"
    "bg-orange-300" = "bg-primary-300"
    "bg-orange-400" = "bg-primary-400"
    "bg-orange-500" = "bg-primary-500"
    "bg-orange-600" = "bg-primary-600"
    "bg-orange-700" = "bg-primary-700"
    "bg-orange-800" = "bg-primary-800"
    
    # Text colors
    "text-orange-50" = "text-gold-50"
    "text-orange-100" = "text-gold-100"
    "text-orange-200" = "text-gold-200"
    "text-orange-300" = "text-primary-300"
    "text-orange-400" = "text-primary-400"
    "text-orange-500" = "text-primary-500"
    "text-orange-600" = "text-primary-600"
    "text-orange-700" = "text-primary-700"
    "text-orange-800" = "text-primary-800"
    
    # Border colors
    "border-orange-50" = "border-gold-50"
    "border-orange-100" = "border-gold-100"
    "border-orange-200" = "border-gold-200"
    "border-orange-300" = "border-primary-300"
    "border-orange-400" = "border-primary-400"
    "border-orange-500" = "border-primary-500"
    "border-orange-600" = "border-primary-600"
    "border-orange-700" = "border-primary-700"
    "border-orange-800" = "border-primary-800"
    
    # Hover states
    "hover:bg-orange-50" = "hover:bg-gold-50"
    "hover:bg-orange-100" = "hover:bg-gold-100"
    "hover:bg-orange-200" = "hover:bg-gold-200"
    "hover:bg-orange-300" = "hover:bg-primary-300"
    "hover:bg-orange-400" = "hover:bg-primary-400"
    "hover:bg-orange-500" = "hover:bg-primary-500"
    "hover:bg-orange-600" = "hover:bg-primary-600"
    "hover:bg-orange-700" = "hover:bg-primary-700"
    "hover:bg-orange-800" = "hover:bg-primary-800"
    
    "hover:text-orange-200" = "hover:text-gold-200"
    "hover:text-orange-300" = "hover:text-primary-300"
    "hover:text-orange-400" = "hover:text-primary-400"
    "hover:text-orange-500" = "hover:text-primary-500"
    "hover:text-orange-600" = "hover:text-primary-600"
    
    "hover:border-orange-400" = "hover:border-primary-400"
    "hover:border-orange-500" = "hover:border-primary-500"
    
    # Ring colors
    "ring-orange-500" = "ring-gold-500"
    "focus:ring-orange-500" = "focus:ring-gold-500"
    
    # Dark mode
    "dark:bg-orange-500" = "dark:bg-primary-500"
    "dark:text-orange-400" = "dark:text-gold-400"
    "dark:text-orange-500" = "dark:text-gold-500"
    "dark:hover:bg-orange-600" = "dark:hover:bg-primary-600"
    "dark:hover:text-orange-200" = "dark:hover:text-gold-200"
    "dark:hover:text-orange-400" = "dark:hover:text-gold-400"
}

$totalReplacements = 0

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw -Encoding UTF8
        $originalContent = $content
        
        foreach ($key in $replacements.Keys) {
            $content = $content -replace [regex]::Escape($key), $replacements[$key]
        }
        
        if ($content -ne $originalContent) {
            Set-Content -Path $file -Value $content -Encoding UTF8 -NoNewline
            $totalReplacements++
            Write-Host "✅ Updated: $file" -ForegroundColor Green
        }
    } else {
        Write-Host "⚠️  Not found: $file" -ForegroundColor Yellow
    }
}

Write-Host "`n✨ Migration complete! Updated $totalReplacements files." -ForegroundColor Cyan
